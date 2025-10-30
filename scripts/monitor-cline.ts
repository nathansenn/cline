#!/usr/bin/env ts-node
/**
 * Cline Runtime Monitor
 *
 * This script monitors Cline's runtime state and outputs the current task status,
 * recent chat messages, and whether Cline is waiting for input.
 *
 * Usage:
 *   ts-node scripts/monitor-cline.ts [--watch] [--last-n=10]
 *
 * Options:
 *   --watch        Continuously monitor and output changes
 *   --last-n=N     Show last N messages (default: 10)
 *   --task-id=ID   Monitor specific task ID
 */

import * as fs from 'fs'
import * as path from 'path'
import { homedir } from 'os'

interface ClineMessage {
	type: string
	ts: number
	text?: string
	say?: string
	ask?: string
	tool?: string
	command?: string
	path?: string
	content?: string
	partial?: boolean
}

interface TaskHistory {
	id: string
	ts: number
	task: string
	tokensIn: number
	tokensOut: number
	cacheWrites?: number
	cacheReads?: number
	totalCost: number
	clineMessages: ClineMessage[]
}

interface ClineState {
	version: string
	taskHistory?: TaskHistory[]
	currentTaskId?: string
}

class ClineMonitor {
	private globalStoragePath: string
	private lastMessageCount: number = 0
	private lastTaskId: string | null = null

	constructor() {
		// Determine the global storage path based on platform
		const platform = process.platform
		let appDataPath: string

		if (platform === 'linux') {
			appDataPath = path.join(homedir(), '.config', 'Code', 'User', 'globalStorage')
		} else if (platform === 'darwin') {
			appDataPath = path.join(
				homedir(),
				'Library',
				'Application Support',
				'Code',
				'User',
				'globalStorage'
			)
		} else if (platform === 'win32') {
			appDataPath = path.join(process.env.APPDATA || '', 'Code', 'User', 'globalStorage')
		} else {
			throw new Error(`Unsupported platform: ${platform}`)
		}

		// Cline's extension ID storage path
		this.globalStoragePath = path.join(appDataPath, 'saoudrizwan.claude-dev')
	}

	/**
	 * Read the task history from disk
	 */
	private readTaskHistory(): TaskHistory[] {
		const historyPath = path.join(this.globalStoragePath, 'taskHistory.json')

		if (!fs.existsSync(historyPath)) {
			return []
		}

		try {
			const content = fs.readFileSync(historyPath, 'utf-8')
			return JSON.parse(content)
		} catch (error) {
			console.error('Error reading task history:', error)
			return []
		}
	}

	/**
	 * Get the current active task (most recent task)
	 */
	private getCurrentTask(taskId?: string): TaskHistory | null {
		const history = this.readTaskHistory()

		if (history.length === 0) {
			return null
		}

		if (taskId) {
			return history.find((task) => task.id === taskId) || null
		}

		// Return the most recent task
		return history[history.length - 1]
	}

	/**
	 * Determine task status based on messages
	 */
	private analyzeTaskStatus(task: TaskHistory): {
		status: 'waiting_for_input' | 'processing' | 'completed' | 'idle' | 'error'
		waitingOn?: string
		lastAction?: string
		needsIntervention: boolean
	} {
		const messages = task.clineMessages || []
		if (messages.length === 0) {
			return { status: 'idle', needsIntervention: false }
		}

		const lastMessage = messages[messages.length - 1]

		// Check if waiting for user response
		if (lastMessage.ask) {
			return {
				status: 'waiting_for_input',
				waitingOn: lastMessage.ask,
				needsIntervention: true,
			}
		}

		// Check for errors or completion
		const recentText = messages
			.slice(-5)
			.map((m) => m.say || m.text || '')
			.join(' ')
			.toLowerCase()

		if (recentText.includes('error') || recentText.includes('failed')) {
			return {
				status: 'error',
				lastAction: lastMessage.say || lastMessage.text,
				needsIntervention: true,
			}
		}

		if (recentText.includes('completed') || recentText.includes('done')) {
			return {
				status: 'completed',
				lastAction: lastMessage.say || lastMessage.text,
				needsIntervention: false,
			}
		}

		// Check if currently processing (recent tool use or API call)
		const hasRecentActivity = messages.some((m, idx) => {
			const isRecent = idx >= messages.length - 3
			return isRecent && (m.tool || m.type === 'api_req_started')
		})

		if (hasRecentActivity) {
			return {
				status: 'processing',
				lastAction: lastMessage.say || lastMessage.text,
				needsIntervention: false,
			}
		}

		return {
			status: 'idle',
			lastAction: lastMessage.say || lastMessage.text,
			needsIntervention: true,
		}
	}

	/**
	 * Format a message for display
	 */
	private formatMessage(msg: ClineMessage): string {
		const timestamp = new Date(msg.ts).toISOString()
		const lines: string[] = [`[${timestamp}] ${msg.type}`]

		if (msg.ask) {
			lines.push(`  ASK: ${msg.ask}`)
		}
		if (msg.say) {
			lines.push(`  SAY: ${msg.say}`)
		}
		if (msg.text) {
			lines.push(`  TEXT: ${msg.text}`)
		}
		if (msg.tool) {
			lines.push(`  TOOL: ${msg.tool}`)
		}
		if (msg.command) {
			lines.push(`  CMD: ${msg.command}`)
		}
		if (msg.partial) {
			lines.push(`  (partial message)`)
		}

		return lines.join('\n')
	}

	/**
	 * Output current state in JSON format for Claude Code to parse
	 */
	public outputState(options: { lastN?: number; taskId?: string; format?: 'json' | 'text' }): void {
		const task = this.getCurrentTask(options.taskId)

		if (!task) {
			const output = {
				error: 'No active task found',
				timestamp: new Date().toISOString(),
			}
			console.log(JSON.stringify(output, null, 2))
			return
		}

		const messages = task.clineMessages || []
		const lastN = options.lastN || 10
		const recentMessages = messages.slice(-lastN)
		const status = this.analyzeTaskStatus(task)

		const output = {
			taskId: task.id,
			taskDescription: task.task,
			timestamp: new Date().toISOString(),
			status: status.status,
			needsIntervention: status.needsIntervention,
			waitingOn: status.waitingOn,
			lastAction: status.lastAction,
			messageCount: messages.length,
			tokensUsed: {
				input: task.tokensIn,
				output: task.tokensOut,
				cacheWrites: task.cacheWrites,
				cacheReads: task.cacheReads,
			},
			totalCost: task.totalCost,
			recentMessages: recentMessages.map((msg) => ({
				type: msg.type,
				timestamp: new Date(msg.ts).toISOString(),
				ask: msg.ask,
				say: msg.say,
				text: msg.text,
				tool: msg.tool,
				command: msg.command,
				partial: msg.partial,
			})),
		}

		if (options.format === 'text') {
			console.log('='.repeat(80))
			console.log(`CLINE TASK MONITOR - ${output.timestamp}`)
			console.log('='.repeat(80))
			console.log(`Task ID: ${output.taskId}`)
			console.log(`Description: ${output.taskDescription}`)
			console.log(`Status: ${output.status}`)
			console.log(`Needs Intervention: ${output.needsIntervention ? 'YES' : 'NO'}`)
			if (output.waitingOn) {
				console.log(`Waiting On: ${output.waitingOn}`)
			}
			if (output.lastAction) {
				console.log(`Last Action: ${output.lastAction}`)
			}
			console.log(`\nTokens: ${output.tokensUsed.input} in / ${output.tokensUsed.output} out`)
			console.log(`Total Cost: $${output.totalCost.toFixed(4)}`)
			console.log(`\nRecent Messages (last ${lastN}):`)
			console.log('-'.repeat(80))
			recentMessages.forEach((msg) => {
				console.log(this.formatMessage(msg))
				console.log('-'.repeat(80))
			})
		} else {
			console.log(JSON.stringify(output, null, 2))
		}
	}

	/**
	 * Watch for changes and output when state changes
	 */
	public watch(options: { lastN?: number; taskId?: string; intervalMs?: number }): void {
		const intervalMs = options.intervalMs || 2000

		console.log(`Starting Cline monitor (checking every ${intervalMs}ms)...`)
		console.log('Press Ctrl+C to stop\n')

		setInterval(() => {
			const task = this.getCurrentTask(options.taskId)

			if (!task) {
				if (this.lastTaskId !== null) {
					console.log('[MONITOR] No active task found')
					this.lastTaskId = null
					this.lastMessageCount = 0
				}
				return
			}

			const messages = task.clineMessages || []
			const hasNewMessages = messages.length !== this.lastMessageCount || task.id !== this.lastTaskId

			if (hasNewMessages) {
				this.lastMessageCount = messages.length
				this.lastTaskId = task.id
				console.log(`\n[MONITOR] State changed at ${new Date().toISOString()}`)
				this.outputState({ ...options, format: 'json' })
			}
		}, intervalMs)
	}
}

// CLI execution
function main() {
	const args = process.argv.slice(2)
	const monitor = new ClineMonitor()

	const options: any = {
		lastN: 10,
		format: 'json',
	}

	let watchMode = false

	// Parse arguments
	for (const arg of args) {
		if (arg === '--watch') {
			watchMode = true
		} else if (arg.startsWith('--last-n=')) {
			options.lastN = parseInt(arg.split('=')[1], 10)
		} else if (arg.startsWith('--task-id=')) {
			options.taskId = arg.split('=')[1]
		} else if (arg === '--text') {
			options.format = 'text'
		} else if (arg === '--json') {
			options.format = 'json'
		}
	}

	if (watchMode) {
		monitor.watch(options)
	} else {
		monitor.outputState(options)
	}
}

if (require.main === module) {
	main()
}

export { ClineMonitor }
