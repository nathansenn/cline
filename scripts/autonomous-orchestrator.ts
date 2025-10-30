#!/usr/bin/env ts-node
/**
 * Autonomous Cline Orchestrator
 *
 * This script monitors Cline's execution and automatically sends responses
 * when appropriate, acting as a fully autonomous supervisor.
 *
 * Usage:
 *   ts-node --project scripts/tsconfig.json scripts/autonomous-orchestrator.ts
 *
 * Features:
 * - Monitors Cline's runtime state
 * - Analyzes when Cline needs input
 * - Automatically sends responses via gRPC
 * - Logs all decisions for review
 * - Supports confidence thresholds for auto-response
 */

import { ClineMonitor } from './monitor-cline'
import { ClineGrpcClient } from './cline-grpc-client'
import * as fs from 'fs'
import * as path from 'path'

interface Decision {
	timestamp: string
	taskId: string
	taskStatus: string
	analysis: string
	recommendation: string
	suggestedResponse?: string
	shouldContinue: boolean
	confidence: 'high' | 'medium' | 'low'
	reasoning: string
	autoResponseSent: boolean
}

class AutonomousOrchestrator {
	private monitor: ClineMonitor
	private grpcClient: ClineGrpcClient | null = null
	private outputDir: string
	private lastMessageCount: number = 0
	private lastTaskId: string | null = null
	private confidenceThreshold: 'high' | 'medium' | 'low'
	private useGrpc: boolean

	constructor(options: {
		outputDir?: string
		confidenceThreshold?: 'high' | 'medium' | 'low'
		useGrpc?: boolean
		grpcHost?: string
		grpcPort?: number
	}) {
		this.monitor = new ClineMonitor()
		this.outputDir = options.outputDir || path.join(process.cwd(), '.cline-orchestrator')
		this.confidenceThreshold = options.confidenceThreshold || 'high'
		this.useGrpc = options.useGrpc !== false // default to true

		if (this.useGrpc) {
			this.grpcClient = new ClineGrpcClient(
				options.grpcHost || '127.0.0.1',
				options.grpcPort || 26040
			)
		}

		// Create output directory
		if (!fs.existsSync(this.outputDir)) {
			fs.mkdirSync(this.outputDir, { recursive: true })
		}
	}

	/**
	 * Initialize the orchestrator
	 */
	async initialize(): Promise<void> {
		if (this.useGrpc && this.grpcClient) {
			try {
				await this.grpcClient.initialize()
				console.log('✓ Connected to Cline gRPC service')
			} catch (error: any) {
				console.warn('⚠ gRPC service not available:', error.message)
				console.warn('  Auto-response will be disabled. See CLINE_ORCHESTRATION.md for setup.')
				this.useGrpc = false
				this.grpcClient = null
			}
		}
	}

	/**
	 * Analyze Cline's state and make decision
	 */
	private async analyzeAndDecide(state: any): Promise<Decision> {
		let analysis = ''
		let recommendation = ''
		let suggestedResponse: string | undefined
		let shouldContinue = false
		let confidence: 'high' | 'medium' | 'low' = 'medium'
		let reasoning = ''

		switch (state.status) {
			case 'waiting_for_input':
				analysis = `Cline is waiting for user input. Question: "${state.waitingOn}"`
				reasoning = `Cline has asked a question and needs a response to continue.`

				const question = state.waitingOn.toLowerCase()

				if (question.includes('continue') || question.includes('proceed')) {
					recommendation = 'Approve continuation'
					suggestedResponse = 'Yes, please continue.'
					shouldContinue = true
					confidence = 'high'
					reasoning += ' The question is asking for permission to continue.'
				} else if (question.includes('should i')) {
					recommendation = 'Approve suggested action'
					suggestedResponse = 'Yes, please proceed with your suggested approach.'
					shouldContinue = true
					confidence = 'high'
					reasoning += ' Cline is asking for approval of its plan.'
				} else if (question.includes('fix') || question.includes('update')) {
					recommendation = 'Approve changes'
					suggestedResponse = 'Yes, please make those changes.'
					shouldContinue = true
					confidence = 'high'
					reasoning += ' Cline wants to make changes.'
				} else if (question.includes('error') || question.includes('problem')) {
					recommendation = 'Review error - respond with guidance'
					confidence = 'low'
					reasoning += ' Cline encountered an issue that may need human review.'
				} else if (
					question.includes('which') ||
					question.includes('what should') ||
					question.includes('how should')
				) {
					recommendation = 'Question requires specific information'
					confidence = 'low'
					reasoning += ' Open-ended question needs specific input.'
				} else {
					// Default: try to approve if it seems reasonable
					recommendation = 'Tentatively approve'
					suggestedResponse = 'Yes, please continue.'
					shouldContinue = true
					confidence = 'medium'
					reasoning += ' General question, defaulting to approval.'
				}
				break

			case 'error':
				analysis = `Cline encountered an error. Last action: "${state.lastAction}"`
				recommendation = 'Review error and recent messages'
				confidence = 'low'
				reasoning = 'Cline reported an error. Manual review recommended.'
				break

			case 'completed':
				analysis = `Task appears completed. Last action: "${state.lastAction}"`
				recommendation = 'Verify completion'
				confidence = 'high'
				reasoning = 'Cline indicated task completion.'
				break

			case 'processing':
				analysis = `Cline is actively working. Last action: "${state.lastAction}"`
				recommendation = 'No action needed'
				confidence = 'high'
				reasoning = 'Cline is actively working.'
				break

			case 'idle':
				analysis = `Cline is idle. Last action: "${state.lastAction}"`
				recommendation = 'Check if stuck or complete'
				confidence = 'medium'
				reasoning = 'Cline stopped without clear indication.'

				// Check recent messages for context
				const lastActions = state.recentMessages
					.slice(-3)
					.map((m: any) => (m.say || m.text || '').toLowerCase())
					.join(' ')

				if (lastActions.includes('done') || lastActions.includes('completed')) {
					recommendation = 'Task likely completed'
					confidence = 'high'
				} else if (lastActions.includes('waiting')) {
					recommendation = 'Cline may be stuck'
					suggestedResponse = 'Please continue with the next step.'
					shouldContinue = true
					confidence = 'medium'
				}
				break

			default:
				analysis = `Unknown status: ${state.status}`
				recommendation = 'Manual review required'
				confidence = 'low'
				reasoning = 'Unexpected status.'
		}

		return {
			timestamp: new Date().toISOString(),
			taskId: state.taskId,
			taskStatus: state.status,
			analysis,
			recommendation,
			suggestedResponse,
			shouldContinue,
			confidence,
			reasoning,
			autoResponseSent: false,
		}
	}

	/**
	 * Send response to Cline automatically if confidence is high enough
	 */
	private async sendAutoResponse(decision: Decision): Promise<boolean> {
		if (!this.useGrpc || !this.grpcClient) {
			return false
		}

		if (!decision.shouldContinue || !decision.suggestedResponse) {
			return false
		}

		// Check confidence threshold
		const confidenceLevels = { low: 0, medium: 1, high: 2 }
		const requiredLevel = confidenceLevels[this.confidenceThreshold]
		const decisionLevel = confidenceLevels[decision.confidence]

		if (decisionLevel < requiredLevel) {
			console.log(
				`⚠ Confidence ${decision.confidence} below threshold ${this.confidenceThreshold}, skipping auto-response`
			)
			return false
		}

		try {
			console.log(`🤖 Sending auto-response: "${decision.suggestedResponse}"`)
			await this.grpcClient.sendMessageResponse(decision.suggestedResponse)
			console.log('✓ Response sent successfully')
			return true
		} catch (error: any) {
			console.error('✗ Failed to send response:', error.message)
			return false
		}
	}

	/**
	 * Save decision to file
	 */
	private saveDecision(decision: Decision): void {
		const filename = `decision-${Date.now()}.json`
		const filepath = path.join(this.outputDir, filename)

		fs.writeFileSync(filepath, JSON.stringify(decision, null, 2))

		// Also save as latest
		const latestPath = path.join(this.outputDir, 'latest-decision.json')
		fs.writeFileSync(latestPath, JSON.stringify(decision, null, 2))

		// Save suggested response if available
		if (decision.suggestedResponse) {
			const responsePath = path.join(this.outputDir, 'suggested-response.txt')
			fs.writeFileSync(responsePath, decision.suggestedResponse)
		}
	}

	/**
	 * Run the orchestration loop
	 */
	async run(intervalMs: number = 3000): Promise<void> {
		console.log('='.repeat(80))
		console.log('AUTONOMOUS CLINE ORCHESTRATOR')
		console.log('='.repeat(80))
		console.log(`Check interval:        ${intervalMs}ms`)
		console.log(`Confidence threshold:  ${this.confidenceThreshold}`)
		console.log(`Auto-response:         ${this.useGrpc ? 'ENABLED' : 'DISABLED'}`)
		console.log(`Output directory:      ${this.outputDir}`)
		console.log('\nPress Ctrl+C to stop\n')

		setInterval(async () => {
			try {
				// Get current state
				const stateCapture: any = await new Promise((resolve) => {
					const originalLog = console.log
					let output = ''

					console.log = (msg: string) => {
						output += msg
					}

					this.monitor.outputState({ lastN: 10, format: 'json' })

					console.log = originalLog

					try {
						resolve(JSON.parse(output))
					} catch (e) {
						resolve(null)
					}
				})

				if (!stateCapture || stateCapture.error) {
					if (this.lastTaskId !== null) {
						console.log(`[${new Date().toISOString()}] No active task`)
						this.lastTaskId = null
					}
					return
				}

				// Check if state changed
				const hasChanged =
					stateCapture.messageCount !== this.lastMessageCount ||
					stateCapture.taskId !== this.lastTaskId

				if (!hasChanged && !stateCapture.needsIntervention) {
					return
				}

				this.lastMessageCount = stateCapture.messageCount
				this.lastTaskId = stateCapture.taskId

				console.log(`\n[${new Date().toISOString()}] State change detected`)
				console.log(`Status: ${stateCapture.status}`)
				console.log(`Needs Intervention: ${stateCapture.needsIntervention}`)

				// Make decision
				const decision = await this.analyzeAndDecide(stateCapture)

				console.log('\n' + '='.repeat(80))
				console.log('DECISION')
				console.log('='.repeat(80))
				console.log(`Analysis:      ${decision.analysis}`)
				console.log(`Recommendation: ${decision.recommendation}`)
				console.log(`Confidence:    ${decision.confidence}`)
				console.log(`Reasoning:     ${decision.reasoning}`)

				if (decision.suggestedResponse) {
					console.log(`\nSuggested Response: "${decision.suggestedResponse}"`)
				}

				// Try to send auto-response
				if (decision.shouldContinue && this.useGrpc) {
					const sent = await this.sendAutoResponse(decision)
					decision.autoResponseSent = sent

					if (!sent && decision.suggestedResponse) {
						console.log('\n⚠ Auto-response not sent. Manual intervention required.')
						console.log(`   Copy this response to Cline: "${decision.suggestedResponse}"`)
					}
				} else if (decision.suggestedResponse && !this.useGrpc) {
					console.log('\n⚠ gRPC not available. Please manually send:')
					console.log(`   "${decision.suggestedResponse}"`)
				}

				// Save decision
				this.saveDecision(decision)

				console.log('\n' + '='.repeat(80))
			} catch (error: any) {
				console.error('[ORCHESTRATOR] Error:', error.message)
			}
		}, intervalMs)
	}

	/**
	 * Cleanup
	 */
	cleanup(): void {
		if (this.grpcClient) {
			this.grpcClient.close()
		}
	}
}

// CLI execution
async function main() {
	const args = process.argv.slice(2)

	const options: any = {
		intervalMs: 3000,
		confidenceThreshold: 'high',
		useGrpc: true,
	}

	for (const arg of args) {
		if (arg.startsWith('--interval=')) {
			options.intervalMs = parseInt(arg.split('=')[1], 10)
		} else if (arg.startsWith('--confidence=')) {
			options.confidenceThreshold = arg.split('=')[1] as 'high' | 'medium' | 'low'
		} else if (arg === '--no-grpc') {
			options.useGrpc = false
		} else if (arg.startsWith('--output=')) {
			options.outputDir = arg.split('=')[1]
		} else if (arg === '--help') {
			console.log(`
Autonomous Cline Orchestrator - Automatically supervise and respond to Cline

Usage:
  npx ts-node --project scripts/tsconfig.json scripts/autonomous-orchestrator.ts [OPTIONS]

Options:
  --interval=MS         Check interval in milliseconds (default: 3000)
  --confidence=LEVEL    Minimum confidence for auto-response: high|medium|low (default: high)
  --no-grpc            Disable gRPC auto-response (monitor only)
  --output=DIR         Custom output directory (default: .cline-orchestrator)
  --help               Show this help

Examples:
  # High confidence only (safest)
  npx ts-node --project scripts/tsconfig.json scripts/autonomous-orchestrator.ts

  # Allow medium confidence auto-responses
  npx ts-node --project scripts/tsconfig.json scripts/autonomous-orchestrator.ts --confidence=medium

  # Monitor only, no auto-response
  npx ts-node --project scripts/tsconfig.json scripts/autonomous-orchestrator.ts --no-grpc

  # Custom check interval
  npx ts-node --project scripts/tsconfig.json scripts/autonomous-orchestrator.ts --interval=5000

Environment Variables:
  CLINE_GRPC_HOST     gRPC host (default: 127.0.0.1)
  CLINE_GRPC_PORT     gRPC port (default: 26040)

Note: To enable auto-response, Cline must be running with protobus service enabled.
      See CLINE_ORCHESTRATION.md for setup instructions.
`)
			process.exit(0)
		}
	}

	const orchestrator = new AutonomousOrchestrator(options)

	// Cleanup on exit
	process.on('SIGINT', () => {
		console.log('\n\nShutting down gracefully...')
		orchestrator.cleanup()
		process.exit(0)
	})

	try {
		await orchestrator.initialize()
		await orchestrator.run(options.intervalMs)
	} catch (error: any) {
		console.error('Fatal error:', error.message)
		orchestrator.cleanup()
		process.exit(1)
	}
}

if (require.main === module) {
	main()
}

export { AutonomousOrchestrator }
