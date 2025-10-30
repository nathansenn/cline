#!/usr/bin/env ts-node
/**
 * Cline gRPC Client
 *
 * This script provides a gRPC client for interacting with Cline's protobus service.
 * It allows sending responses programmatically to Cline when it's waiting for input.
 *
 * Usage:
 *   ts-node scripts/cline-grpc-client.ts <response-text>
 *   ts-node scripts/cline-grpc-client.ts --yes
 *   ts-node scripts/cline-grpc-client.ts --no
 */

import * as grpc from '@grpc/grpc-js'
import * as protoLoader from '@grpc/proto-loader'
import * as path from 'path'
import * as fs from 'fs'

const PROTOBUS_PORT = 26040
const PROTO_PATH = path.join(__dirname, '..', 'proto')

interface AskResponseRequest {
	metadata?: any
	responseType: 'yesButtonClicked' | 'noButtonClicked' | 'messageResponse'
	text?: string
	images?: string[]
	files?: string[]
}

interface Empty {}

interface TaskServiceClient extends grpc.Client {
	askResponse(
		request: AskResponseRequest,
		callback: (error: grpc.ServiceError | null, response: Empty) => void
	): grpc.ClientUnaryCall

	askResponse(
		request: AskResponseRequest,
		metadata: grpc.Metadata,
		callback: (error: grpc.ServiceError | null, response: Empty) => void
	): grpc.ClientUnaryCall
}

export class ClineGrpcClient {
	private client: TaskServiceClient | null = null
	private host: string
	private port: number

	constructor(host: string = '127.0.0.1', port: number = PROTOBUS_PORT) {
		this.host = host
		this.port = port
	}

	/**
	 * Initialize the gRPC client
	 */
	async initialize(): Promise<void> {
		// Load proto files
		const packageDefinition = protoLoader.loadSync(
			[
				path.join(PROTO_PATH, 'cline', 'task.proto'),
				path.join(PROTO_PATH, 'cline', 'common.proto'),
				path.join(PROTO_PATH, 'cline', 'ui.proto'),
			],
			{
				keepCase: true,
				longs: String,
				enums: String,
				defaults: true,
				oneofs: true,
				includeDirs: [PROTO_PATH],
			}
		)

		const protoDescriptor = grpc.loadPackageDefinition(packageDefinition) as any

		// Create client
		const TaskService = protoDescriptor.cline.TaskService
		this.client = new TaskService(
			`${this.host}:${this.port}`,
			grpc.credentials.createInsecure()
		) as TaskServiceClient

		// Test connection
		await this.waitForReady()
	}

	/**
	 * Wait for the gRPC service to be ready
	 */
	private async waitForReady(timeoutMs: number = 5000): Promise<void> {
		return new Promise((resolve, reject) => {
			if (!this.client) {
				reject(new Error('Client not initialized'))
				return
			}

			const deadline = new Date(Date.now() + timeoutMs)

			this.client.waitForReady(deadline, (error) => {
				if (error) {
					reject(
						new Error(
							`Failed to connect to Cline protobus service at ${this.host}:${this.port}. ` +
								`Make sure Cline is running with protobus service enabled. Error: ${error.message}`
						)
					)
				} else {
					resolve()
				}
			})
		})
	}

	/**
	 * Send a response to Cline
	 */
	async sendResponse(
		responseType: 'yesButtonClicked' | 'noButtonClicked' | 'messageResponse',
		text?: string,
		images?: string[],
		files?: string[]
	): Promise<void> {
		if (!this.client) {
			throw new Error('Client not initialized. Call initialize() first.')
		}

		const request: AskResponseRequest = {
			metadata: {
				timestamp: Date.now(),
			},
			responseType,
			text: text || '',
			images: images || [],
			files: files || [],
		}

		return new Promise((resolve, reject) => {
			this.client!.askResponse(request, (error, _response) => {
				if (error) {
					reject(new Error(`Failed to send response: ${error.message}`))
				} else {
					resolve()
				}
			})
		})
	}

	/**
	 * Send a text message response
	 */
	async sendMessageResponse(text: string, images?: string[], files?: string[]): Promise<void> {
		return this.sendResponse('messageResponse', text, images, files)
	}

	/**
	 * Send a "Yes" button click
	 */
	async sendYes(): Promise<void> {
		return this.sendResponse('yesButtonClicked')
	}

	/**
	 * Send a "No" button click
	 */
	async sendNo(): Promise<void> {
		return this.sendResponse('noButtonClicked')
	}

	/**
	 * Close the client connection
	 */
	close(): void {
		if (this.client) {
			this.client.close()
			this.client = null
		}
	}
}

// CLI execution
async function main() {
	const args = process.argv.slice(2)

	if (args.length === 0 || args.includes('--help')) {
		console.log(`
Cline gRPC Client - Send responses to Cline programmatically

Usage:
  npx ts-node --project scripts/tsconfig.json scripts/cline-grpc-client.ts <response>
  npx ts-node --project scripts/tsconfig.json scripts/cline-grpc-client.ts --yes
  npx ts-node --project scripts/tsconfig.json scripts/cline-grpc-client.ts --no

Examples:
  # Send a text response
  npx ts-node --project scripts/tsconfig.json scripts/cline-grpc-client.ts "Yes, please continue"

  # Send a "Yes" button click
  npx ts-node --project scripts/tsconfig.json scripts/cline-grpc-client.ts --yes

  # Send a "No" button click
  npx ts-node --project scripts/tsconfig.json scripts/cline-grpc-client.ts --no

  # Send a response with specific instructions
  npx ts-node --project scripts/tsconfig.json scripts/cline-grpc-client.ts "Fix the type errors in src/utils.ts"

Environment Variables:
  CLINE_GRPC_HOST     gRPC host (default: 127.0.0.1)
  CLINE_GRPC_PORT     gRPC port (default: 26040)

Note: Cline must be running with the protobus service enabled for this to work.
      See CLINE_ORCHESTRATION.md for setup instructions.
`)
		process.exit(0)
	}

	const host = process.env.CLINE_GRPC_HOST || '127.0.0.1'
	const port = parseInt(process.env.CLINE_GRPC_PORT || '26040', 10)

	const client = new ClineGrpcClient(host, port)

	try {
		console.log(`Connecting to Cline protobus service at ${host}:${port}...`)
		await client.initialize()
		console.log('Connected successfully!')

		// Parse command
		if (args[0] === '--yes') {
			console.log('Sending "Yes" response...')
			await client.sendYes()
			console.log('Response sent successfully!')
		} else if (args[0] === '--no') {
			console.log('Sending "No" response...')
			await client.sendNo()
			console.log('Response sent successfully!')
		} else {
			const text = args.join(' ')
			console.log(`Sending message response: "${text}"`)
			await client.sendMessageResponse(text)
			console.log('Response sent successfully!')
		}
	} catch (error: any) {
		console.error('Error:', error.message)
		process.exit(1)
	} finally {
		client.close()
	}
}

if (require.main === module) {
	main()
}

export { ClineGrpcClient }
