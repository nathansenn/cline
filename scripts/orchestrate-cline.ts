#!/usr/bin/env ts-node
/**
 * Cline Orchestrator
 *
 * This script monitors Cline's execution and uses Claude Code to determine
 * what actions should be taken next. It acts as an autonomous supervisor that
 * reads Cline's output and decides when to intervene.
 *
 * Usage:
 *   ts-node scripts/orchestrate-cline.ts
 *
 * The orchestrator will:
 * 1. Monitor Cline's current task
 * 2. Analyze the chat output when Cline stops or needs input
 * 3. Determine the appropriate next action
 * 4. Output a recommendation or write to a response file
 */

import * as fs from 'fs'
import * as path from 'path'
import { ClineMonitor } from './monitor-cline'

interface OrchestrationDecision {
	timestamp: string
	taskId: string
	taskStatus: string
	analysis: string
	recommendation: string
	suggestedResponse?: string
	shouldContinue: boolean
	confidence: 'high' | 'medium' | 'low'
	reasoning: string
}

class ClineOrchestrator {
	private monitor: ClineMonitor
	private outputDir: string
	private lastDecisionTime: number = 0
	private minDecisionInterval: number = 5000 // 5 seconds minimum between decisions

	constructor(outputDir?: string) {
		this.monitor = new ClineMonitor()
		this.outputDir = outputDir || path.join(process.cwd(), '.cline-orchestrator')

		// Create output directory if it doesn't exist
		if (!fs.existsSync(this.outputDir)) {
			fs.mkdirSync(this.outputDir, { recursive: true })
		}
	}

	/**
	 * Analyze Cline's current state and make a decision
	 */
	private async analyzeAndDecide(state: any): Promise<OrchestrationDecision> {
		const now = Date.now()

		// Build context from recent messages
		const recentContext = state.recentMessages
			.map((msg: any) => {
				const parts: string[] = []
				if (msg.say) parts.push(`[Cline]: ${msg.say}`)
				if (msg.ask) parts.push(`[Cline asks]: ${msg.ask}`)
				if (msg.text) parts.push(`[Text]: ${msg.text}`)
				if (msg.tool) parts.push(`[Tool used]: ${msg.tool}`)
				if (msg.command) parts.push(`[Command]: ${msg.command}`)
				return parts.join(' ')
			})
			.filter((s: string) => s.length > 0)
			.join('\n')

		// Determine what to do based on status
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

				// Analyze the question to determine appropriate response
				const question = state.waitingOn.toLowerCase()

				if (question.includes('continue') || question.includes('proceed')) {
					recommendation = 'Approve continuation'
					suggestedResponse = 'Yes, please continue.'
					shouldContinue = true
					confidence = 'high'
					reasoning += ' The question is asking for permission to continue, which can be automatically approved.'
				} else if (question.includes('error') || question.includes('problem')) {
					recommendation = 'Review error and provide guidance'
					suggestedResponse = undefined
					shouldContinue = false
					confidence = 'medium'
					reasoning += ' Cline encountered an issue that requires human review.'
				} else if (
					question.includes('which') ||
					question.includes('what') ||
					question.includes('how')
				) {
					recommendation = 'Question requires specific information - needs human input'
					shouldContinue = false
					confidence = 'high'
					reasoning += ' This is an open-ended question requiring specific information.'
				} else {
					recommendation = 'Ambiguous question - review context before responding'
					shouldContinue = false
					confidence = 'low'
					reasoning += ' Unable to confidently determine appropriate response.'
				}
				break

			case 'error':
				analysis = `Cline encountered an error. Last action: "${state.lastAction}"`
				recommendation = 'Review error logs and recent messages to diagnose issue'
				shouldContinue = false
				confidence = 'high'
				reasoning =
					'Cline reported an error. Manual intervention needed to understand and resolve the issue.'
				break

			case 'completed':
				analysis = `Task appears to be completed. Last action: "${state.lastAction}"`
				recommendation = 'Verify completion and close task or assign new work'
				shouldContinue = false
				confidence = 'high'
				reasoning = 'Cline has indicated task completion. Verify results before proceeding.'
				break

			case 'processing':
				analysis = `Cline is actively processing. Last action: "${state.lastAction}"`
				recommendation = 'No intervention needed - continue monitoring'
				shouldContinue = false
				confidence = 'high'
				reasoning = 'Cline is actively working. No action required at this time.'
				break

			case 'idle':
				analysis = `Cline is idle. Last action: "${state.lastAction}"`
				recommendation = 'Determine if task is complete or if Cline needs new instructions'
				shouldContinue = false
				confidence = 'medium'
				reasoning =
					'Cline has stopped activity. Check if this is expected completion or if it needs guidance.'

				// Check if it looks like completion
				const lastActions = state.recentMessages
					.slice(-3)
					.map((m: any) => (m.say || m.text || '').toLowerCase())
					.join(' ')

				if (lastActions.includes('done') || lastActions.includes('completed')) {
					recommendation = 'Task likely completed - verify results'
					confidence = 'high'
				} else if (lastActions.includes('waiting') || lastActions.includes('need')) {
					recommendation = 'Cline may be waiting for something - review context'
					suggestedResponse = 'Please continue with the next step.'
					shouldContinue = true
					confidence = 'medium'
				}
				break

			default:
				analysis = `Unknown status: ${state.status}`
				recommendation = 'Manual review required'
				shouldContinue = false
				confidence = 'low'
				reasoning = 'Unexpected status detected.'
		}

		const decision: OrchestrationDecision = {
			timestamp: new Date().toISOString(),
			taskId: state.taskId,
			taskStatus: state.status,
			analysis,
			recommendation,
			suggestedResponse,
			shouldContinue,
			confidence,
			reasoning,
		}

		return decision
	}

	/**
	 * Save decision to file
	 */
	private saveDecision(decision: OrchestrationDecision): void {
		const filename = `decision-${Date.now()}.json`
		const filepath = path.join(this.outputDir, filename)

		fs.writeFileSync(filepath, JSON.stringify(decision, null, 2))
		console.log(`\n[ORCHESTRATOR] Decision saved to: ${filepath}`)

		// Also save as latest
		const latestPath = path.join(this.outputDir, 'latest-decision.json')
		fs.writeFileSync(latestPath, JSON.stringify(decision, null, 2))

		// If there's a suggested response, save it separately
		if (decision.suggestedResponse) {
			const responsePath = path.join(this.outputDir, 'suggested-response.txt')
			fs.writeFileSync(responsePath, decision.suggestedResponse)
		}
	}

	/**
	 * Generate a detailed report for Claude Code to review
	 */
	private generateClaudePrompt(state: any, decision: OrchestrationDecision): string {
		return `# Cline Task Orchestration Analysis

## Task Information
- **Task ID**: ${state.taskId}
- **Description**: ${state.taskDescription}
- **Current Status**: ${state.status}
- **Needs Intervention**: ${state.needsIntervention ? 'YES' : 'NO'}

## Recent Activity
${state.recentMessages
	.map(
		(msg: any, idx: number) => `
### Message ${idx + 1} (${msg.timestamp})
- **Type**: ${msg.type}
${msg.say ? `- **Cline Says**: ${msg.say}` : ''}
${msg.ask ? `- **Cline Asks**: ${msg.ask}` : ''}
${msg.text ? `- **Text**: ${msg.text}` : ''}
${msg.tool ? `- **Tool Used**: ${msg.tool}` : ''}
${msg.command ? `- **Command**: ${msg.command}` : ''}
`
	)
	.join('\n')}

## Orchestrator Analysis
- **Recommendation**: ${decision.recommendation}
- **Should Continue**: ${decision.shouldContinue ? 'YES' : 'NO'}
- **Confidence**: ${decision.confidence}
- **Reasoning**: ${decision.reasoning}
${decision.suggestedResponse ? `- **Suggested Response**: "${decision.suggestedResponse}"` : ''}

## Your Task
Please review the above information and determine:

1. **What is Cline currently doing?** Summarize its current state and recent actions.
2. **What should happen next?** Based on the context, what is the appropriate next step?
3. **What response (if any) should be provided to Cline?** If Cline is waiting for input, what should be said?
4. **Are there any issues or concerns?** Are there any errors, problems, or unexpected behaviors?

Provide your analysis in a clear, structured format.
`
	}

	/**
	 * Run orchestration loop
	 */
	public async run(options: { intervalMs?: number; autoApprove?: boolean }): Promise<void> {
		const intervalMs = options.intervalMs || 3000
		const autoApprove = options.autoApprove || false

		console.log('='.repeat(80))
		console.log('CLINE ORCHESTRATOR')
		console.log('='.repeat(80))
		console.log(`Monitoring interval: ${intervalMs}ms`)
		console.log(`Auto-approve: ${autoApprove ? 'ENABLED' : 'DISABLED'}`)
		console.log(`Output directory: ${this.outputDir}`)
		console.log('\nPress Ctrl+C to stop\n')

		let lastMessageCount = 0
		let lastTaskId: string | null = null

		setInterval(async () => {
			try {
				// Get current state (we'll capture the output)
				const stateCapture: any = await new Promise((resolve) => {
					const originalLog = console.log
					let output = ''

					console.log = (msg: string) => {
						output += msg
					}

					this.monitor.outputState({ lastN: 10, format: 'json' })

					console.log = originalLog

					try {
						const state = JSON.parse(output)
						resolve(state)
					} catch (e) {
						resolve(null)
					}
				})

				if (!stateCapture || stateCapture.error) {
					if (lastTaskId !== null) {
						console.log(`[${new Date().toISOString()}] No active task`)
						lastTaskId = null
					}
					return
				}

				// Check if state has changed
				const hasChanged =
					stateCapture.messageCount !== lastMessageCount || stateCapture.taskId !== lastTaskId

				if (!hasChanged && !stateCapture.needsIntervention) {
					return
				}

				lastMessageCount = stateCapture.messageCount
				lastTaskId = stateCapture.taskId

				console.log(`\n[${new Date().toISOString()}] State change detected`)
				console.log(`Status: ${stateCapture.status}`)
				console.log(`Needs Intervention: ${stateCapture.needsIntervention}`)

				// Make decision
				const decision = await this.analyzeAndDecide(stateCapture)

				console.log('\n' + '='.repeat(80))
				console.log('ORCHESTRATOR DECISION')
				console.log('='.repeat(80))
				console.log(`Analysis: ${decision.analysis}`)
				console.log(`Recommendation: ${decision.recommendation}`)
				console.log(`Confidence: ${decision.confidence}`)
				console.log(`Reasoning: ${decision.reasoning}`)

				if (decision.suggestedResponse) {
					console.log(`\nSuggested Response:\n"${decision.suggestedResponse}"`)
				}

				// Save decision
				this.saveDecision(decision)

				// Generate prompt for Claude Code
				const claudePrompt = this.generateClaudePrompt(stateCapture, decision)
				const promptPath = path.join(this.outputDir, 'claude-prompt.md')
				fs.writeFileSync(promptPath, claudePrompt)

				console.log(`\n[ORCHESTRATOR] Claude Code prompt saved to: ${promptPath}`)
				console.log('\nTo get Claude Code analysis, run:')
				console.log(`  cat ${promptPath} | claude-code`)
				console.log('='.repeat(80))
			} catch (error) {
				console.error('[ORCHESTRATOR] Error:', error)
			}
		}, intervalMs)
	}
}

// CLI execution
async function main() {
	const args = process.argv.slice(2)

	const options: any = {
		intervalMs: 3000,
		autoApprove: false,
	}

	let outputDir: string | undefined

	for (const arg of args) {
		if (arg.startsWith('--interval=')) {
			options.intervalMs = parseInt(arg.split('=')[1], 10)
		} else if (arg === '--auto-approve') {
			options.autoApprove = true
		} else if (arg.startsWith('--output=')) {
			outputDir = arg.split('=')[1]
		}
	}

	const orchestrator = new ClineOrchestrator(outputDir)
	await orchestrator.run(options)
}

if (require.main === module) {
	main()
}

export { ClineOrchestrator }
