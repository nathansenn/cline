# Cline Runtime Orchestration with Claude Code

## Overview

This repository now includes a powerful orchestration system that allows **Claude Code to monitor and supervise Cline's execution** in real-time. The system can operate in two modes:

### Monitor Mode (Manual)
Claude Code acts as an intelligent supervisor that:
- **Monitors** Cline's runtime state and chat output
- **Analyzes** what Cline is doing and determines if intervention is needed
- **Recommends** appropriate responses or actions
- **Generates** context-aware prompts for human review

### Autonomous Mode (Automatic) 🤖✨
Claude Code fully automates the supervision:
- **Monitors** Cline's runtime state continuously
- **Analyzes** and makes decisions automatically
- **Responds** directly to Cline via gRPC (no manual intervention!)
- **Logs** all decisions for review

Think of it as having Claude Code watch over Cline's shoulder, ready to step in and help - or even respond automatically!

## Why Use This?

- **Automated supervision**: Let Claude Code watch Cline work instead of constantly checking yourself
- **Intelligent decisions**: Claude Code analyzes context and suggests appropriate responses
- **Faster iteration**: Reduce the back-and-forth by having Claude Code determine next steps
- **Documentation**: All decisions are logged for review and debugging
- **Scalability**: Monitor multiple Cline tasks or run long-running operations with confidence

## Quick Start

### 1. Check Cline's Current State

```bash
npx ts-node --project scripts/tsconfig.json scripts/monitor-cline.ts --text
```

### 2. Start the Orchestrator

```bash
./scripts/watch-and-orchestrate.sh
```

### 3. Let It Run

The orchestrator will:
- Detect when Cline stops or needs input
- Analyze the situation
- Generate a prompt for Claude Code to review
- Output recommended actions

### 4. Provide Response to Cline

When you see a recommendation:
1. Review the suggested response
2. Copy it to your clipboard
3. Paste it into Cline's chat in VS Code
4. Watch Cline continue working

## Components

### 1. Monitor (`scripts/monitor-cline.ts`)

**Purpose**: Reads Cline's task state from disk and outputs current status

**Usage**:
```bash
# One-time check (JSON format)
npx ts-node --project scripts/tsconfig.json scripts/monitor-cline.ts

# Human-readable format
npx ts-node --project scripts/tsconfig.json scripts/monitor-cline.ts --text

# Watch mode (continuous monitoring)
npx ts-node --project scripts/tsconfig.json scripts/monitor-cline.ts --watch

# Show more messages
npx ts-node --project scripts/tsconfig.json scripts/monitor-cline.ts --last-n=20
```

**What it monitors**:
- Task ID and description
- Recent chat messages (asks, says, tool uses)
- Token usage and cost
- Task status (waiting, processing, completed, error, idle)
- Whether intervention is needed

### 2. Orchestrator (`scripts/orchestrate-cline.ts`)

**Purpose**: Analyzes Cline's state and makes intelligent decisions about next actions

**Usage**:
```bash
# Start orchestrator
npx ts-node --project scripts/tsconfig.json scripts/orchestrate-cline.ts

# Custom check interval (milliseconds)
npx ts-node --project scripts/tsconfig.json scripts/orchestrate-cline.ts --interval=5000

# Custom output directory
npx ts-node --project scripts/tsconfig.json scripts/orchestrate-cline.ts --output=/tmp/cline-decisions
```

**What it does**:
- Detects state changes in Cline
- Analyzes recent messages for context
- Determines appropriate action
- Generates recommendations with confidence levels
- Creates detailed prompts for Claude Code review
- Saves decision history

### 3. Watch Script (`scripts/watch-and-orchestrate.sh`)

**Purpose**: Convenient wrapper that runs the orchestrator and integrates with Claude Code

**Usage**:
```bash
# Auto mode (default) - automatically sends prompts to Claude Code
./scripts/watch-and-orchestrate.sh

# Manual mode - shows prompts but doesn't auto-send
./scripts/watch-and-orchestrate.sh --manual

# Custom check interval
./scripts/watch-and-orchestrate.sh --interval=5000
```

### 4. gRPC Client (`scripts/cline-grpc-client.ts`) 🔌

**Purpose**: Sends responses directly to Cline via gRPC

**Usage**:
```bash
# Send a text message
npx ts-node --project scripts/tsconfig.json scripts/cline-grpc-client.ts "Yes, please continue"

# Send a "Yes" button click
npx ts-node --project scripts/tsconfig.json scripts/cline-grpc-client.ts --yes

# Send a "No" button click
npx ts-node --project scripts/tsconfig.json scripts/cline-grpc-client.ts --no
```

**Requirements**:
- Cline must have protobus service enabled (see [Interaction Guide](scripts/INTERACTION_GUIDE.md))

### 5. Autonomous Orchestrator (`scripts/autonomous-orchestrator.ts`) 🤖

**Purpose**: Fully autonomous supervision with automatic responses

**Usage**:
```bash
# Run with high confidence threshold (safest)
npx ts-node --project scripts/tsconfig.json scripts/autonomous-orchestrator.ts

# Allow medium confidence responses
npx ts-node --project scripts/tsconfig.json scripts/autonomous-orchestrator.ts --confidence=medium

# Monitor only, no auto-response
npx ts-node --project scripts/tsconfig.json scripts/autonomous-orchestrator.ts --no-grpc
```

**What it does**:
- Monitors Cline continuously
- Makes decisions automatically
- Sends responses via gRPC when confidence is high enough
- Logs every decision for review

**Safety**: Uses confidence thresholds (high/medium/low) to ensure only appropriate responses are auto-sent

## How It Works

```
┌─────────────────────────────────────────────────────────────┐
│                        CLINE (VS Code)                       │
│                                                              │
│  1. Executes tasks                                          │
│  2. Writes state to taskHistory.json                        │
│  3. Asks questions when stuck                               │
└──────────────────────┬───────────────────────────────────────┘
                       │
                       │ Writes to disk
                       ↓
┌─────────────────────────────────────────────────────────────┐
│                     MONITOR SCRIPT                           │
│                                                              │
│  1. Reads taskHistory.json every N seconds                  │
│  2. Parses messages and current state                       │
│  3. Detects when state changes                              │
└──────────────────────┬───────────────────────────────────────┘
                       │
                       │ Passes state to
                       ↓
┌─────────────────────────────────────────────────────────────┐
│                   ORCHESTRATOR SCRIPT                        │
│                                                              │
│  1. Analyzes recent messages                                │
│  2. Determines task status                                  │
│  3. Makes decision:                                         │
│     - waiting_for_input → suggest response                  │
│     - error → recommend fix                                 │
│     - idle → determine if done or stuck                     │
│     - processing → do nothing                               │
│  4. Generates Claude Code prompt                            │
│  5. Saves decision to .cline-orchestrator/                  │
└──────────────────────┬───────────────────────────────────────┘
                       │
                       │ Creates prompt
                       ↓
┌─────────────────────────────────────────────────────────────┐
│                      CLAUDE CODE                             │
│                                                              │
│  1. Receives prompt with full context                       │
│  2. Analyzes situation                                      │
│  3. Validates or modifies recommendation                    │
│  4. Outputs final response to provide to Cline              │
└──────────────────────┬───────────────────────────────────────┘
                       │
                       │ Human reviews and
                       ↓
┌─────────────────────────────────────────────────────────────┐
│                      YOU (Human)                             │
│                                                              │
│  1. Review Claude Code's analysis                           │
│  2. Copy recommended response                               │
│  3. Paste into Cline's chat                                 │
│  4. Watch Cline continue                                    │
└─────────────────────────────────────────────────────────────┘
```

## Task Status Detection

The orchestrator recognizes these states:

| Status | Description | Needs Intervention? | Recommended Action |
|--------|-------------|---------------------|-------------------|
| `waiting_for_input` | Cline asked a question | ✅ **YES** | Provide response |
| `error` | Cline hit an error | ✅ **YES** | Debug and guide |
| `completed` | Task finished | ⚠️ **VERIFY** | Review results |
| `processing` | Cline is working | ❌ **NO** | Wait and monitor |
| `idle` | Cline stopped unexpectedly | ⚠️ **MAYBE** | Check if stuck |

## Output Files

All orchestrator decisions are saved to `.cline-orchestrator/`:

```
.cline-orchestrator/
├── latest-decision.json          # Most recent decision (for automation)
├── suggested-response.txt        # Ready-to-paste response for Cline
├── claude-prompt.md             # Full context prompt for Claude Code
└── decision-{timestamp}.json    # Historical decisions (timestamped)
```

### Example Decision File

```json
{
  "timestamp": "2025-10-30T10:30:15.000Z",
  "taskId": "abc123-def456-...",
  "taskStatus": "waiting_for_input",
  "analysis": "Cline is waiting for user input. Question: \"I found 15 type errors. Should I fix them all?\"",
  "recommendation": "Approve continuation",
  "suggestedResponse": "Yes, please continue.",
  "shouldContinue": true,
  "confidence": "high",
  "reasoning": "The question is asking for permission to continue, which can be automatically approved."
}
```

## Example Workflows

### Scenario 1: Cline Asks for Permission

**Cline's message**:
> I found 15 type errors across 8 files. Should I fix them all?

**Orchestrator decision**:
- Status: `waiting_for_input`
- Recommendation: "Approve continuation"
- Suggested response: "Yes, please continue."
- Confidence: `high`

**Claude Code analysis**:
> Cline has identified type errors and is asking for permission to fix them.
> This is a routine task that should be approved.
>
> **Response to provide**: "Yes, please fix all 15 type errors. Let me know if you encounter any issues."

**Your action**: Copy response → Paste in Cline → Continue working

---

### Scenario 2: Cline Encounters an Error

**Cline's message**:
> Error: Module not found: 'missing-package'

**Orchestrator decision**:
- Status: `error`
- Recommendation: "Review error logs and recent messages to diagnose issue"
- Confidence: `high`

**Claude Code analysis**:
> Cline encountered a missing dependency error. The package needs to be installed.
>
> **Response to provide**: "Please run: npm install missing-package"

**Your action**: Paste command → Let Cline install → Continue

---

### Scenario 3: Cline Goes Idle

**Cline's last message**:
> Updated 3 files with the new authentication logic.

**Orchestrator decision**:
- Status: `idle`
- Recommendation: "Determine if task is complete or if Cline needs new instructions"
- Confidence: `medium`

**Claude Code analysis**:
> Cline completed the authentication updates but hasn't indicated the task is done.
> Based on the original task, there should also be tests written.
>
> **Response to provide**: "Great! Now please write tests for the new authentication logic."

**Your action**: Provide next task → Cline continues

## Advanced Usage

### Integration with CI/CD

Monitor Cline during automated runs:

```bash
# In your CI script
./scripts/watch-and-orchestrate.sh --manual > orchestration.log &
ORCHESTRATOR_PID=$!

# Run your Cline task
# ...

# Check decisions
cat .cline-orchestrator/latest-decision.json

# Cleanup
kill $ORCHESTRATOR_PID
```

### Custom Decision Logic

Extend the orchestrator for your specific needs:

```typescript
import { ClineOrchestrator } from './scripts/orchestrate-cline'

class CustomOrchestrator extends ClineOrchestrator {
  protected async analyzeAndDecide(state: any) {
    const decision = await super.analyzeAndDecide(state)

    // Add custom logic
    if (state.taskDescription.includes('production')) {
      decision.confidence = 'low' // Always require human review for production
    }

    return decision
  }
}
```

### Programmatic Monitoring

Use the classes in your own Node.js scripts:

```typescript
import { ClineMonitor } from './scripts/monitor-cline'

const monitor = new ClineMonitor()

// One-time state check
monitor.outputState({ lastN: 10, format: 'json' })

// Watch for changes
monitor.watch({
  lastN: 15,
  intervalMs: 2000,
  onStateChange: (state) => {
    console.log('Cline state changed:', state)
  }
})
```

## Troubleshooting

### "No active task found"

**Cause**: Cline isn't running or doesn't have an active task

**Solution**:
1. Open VS Code
2. Open Cline sidebar
3. Start a new task
4. Run the monitor again

### Orchestrator not detecting changes

**Cause**: Cline's state file isn't being updated

**Solution**:
1. Check that `taskHistory.json` exists in Cline's global storage
2. Verify file permissions
3. Try asking Cline a question to force a state update
4. Increase the check interval: `--interval=10000`

### Claude Code command not found

**Cause**: Claude Code CLI not in PATH

**Solution**:
1. Install Claude Code CLI
2. Or use manual mode: `./scripts/watch-and-orchestrate.sh --manual`
3. Then manually pipe prompts: `cat .cline-orchestrator/claude-prompt.md | claude`

### Decisions seem incorrect

**Cause**: Limited context or edge case

**Solution**:
1. Increase message history: `--last-n=30`
2. Review the `reasoning` field in decision files
3. Implement custom decision logic (see Advanced Usage)
4. Always have human review before acting on decisions

## Best Practices

1. **Start in manual mode** until you trust the system
2. **Review all decisions** before executing recommendations
3. **Keep message history high** (`--last-n=20` or more) for better context
4. **Monitor the monitor** - check `.cline-orchestrator/` files to understand decisions
5. **Use version control** - commit before acting on major decisions
6. **Document custom logic** if you extend the orchestrator
7. **Test with simple tasks first** before using on critical work

## Future Enhancements

Potential improvements (contributions welcome!):

- **Auto-response**: Automatically paste responses into Cline via VS Code API
- **Multi-task**: Monitor multiple Cline instances simultaneously
- **Learning**: Track decision accuracy and improve confidence scoring
- **Webhooks**: Trigger external systems when Cline needs help
- **Web UI**: Dashboard for monitoring Cline tasks
- **LLM integration**: Direct API calls to Claude within orchestrator
- **Slack/Discord**: Notifications when intervention is needed

## Documentation

### Getting Started
- **[Quick Start Guide](scripts/QUICK_START.md)** - Get started in 5 minutes (manual mode)
- **[Interaction Guide](scripts/INTERACTION_GUIDE.md)** - Enable autonomous mode with gRPC

### Reference
- **[Full Documentation](scripts/ORCHESTRATION_README.md)** - Complete technical reference

### Source Code
- **[Monitor Script](scripts/monitor-cline.ts)** - Read Cline's state
- **[Orchestrator Script](scripts/orchestrate-cline.ts)** - Decision-making logic
- **[gRPC Client](scripts/cline-grpc-client.ts)** - Send responses to Cline
- **[Autonomous Orchestrator](scripts/autonomous-orchestrator.ts)** - Fully automated supervision
- **[Watch Script](scripts/watch-and-orchestrate.sh)** - Wrapper script

## Contributing

Found a bug or have an idea? Contributions are welcome!

1. Test your changes with a real Cline task
2. Add tests if applicable
3. Update documentation
4. Submit a pull request

## License

Same as the Cline project (Apache-2.0)

---

**Happy orchestrating!** 🤖 Let Claude Code be Cline's supervisor while you focus on building.
