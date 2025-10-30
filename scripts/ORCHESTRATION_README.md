# Cline Orchestration System

This system allows Claude Code to monitor Cline's runtime execution and act as an intelligent orchestrator, determining when Cline needs intervention and what actions should be taken next.

## Overview

The orchestration system consists of three main components:

1. **Monitor** (`monitor-cline.ts`) - Reads Cline's task state and chat messages
2. **Orchestrator** (`orchestrate-cline.ts`) - Analyzes state and makes decisions about next actions
3. **Integration** - Generates prompts for Claude Code to review and approve

## Architecture

```
┌─────────────────┐
│     Cline       │ ← Running in VS Code
│  (Task Agent)   │
└────────┬────────┘
         │
         │ Writes state to disk
         │ (taskHistory.json)
         ↓
┌─────────────────┐
│  File System    │
│  Task History   │
└────────┬────────┘
         │
         │ Reads periodically
         ↓
┌─────────────────┐
│    Monitor      │ ← monitor-cline.ts
│  (State Reader) │
└────────┬────────┘
         │
         │ Parses & analyzes
         ↓
┌─────────────────┐
│  Orchestrator   │ ← orchestrate-cline.ts
│ (Decision Maker)│
└────────┬────────┘
         │
         │ Generates prompts
         ↓
┌─────────────────┐
│  Claude Code    │ ← You provide final review
│  (Supervisor)   │
└────────┬────────┘
         │
         │ Approves/modifies
         ↓
┌─────────────────┐
│ Response to     │
│     Cline       │ ← Paste into Cline chat
└─────────────────┘
```

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Run the Monitor (One-time check)

```bash
# View current Cline state (JSON)
ts-node scripts/monitor-cline.ts

# View in human-readable format
ts-node scripts/monitor-cline.ts --text

# Show last 20 messages
ts-node scripts/monitor-cline.ts --last-n=20
```

### 3. Run the Monitor in Watch Mode

```bash
# Continuously monitor for changes
ts-node scripts/monitor-cline.ts --watch

# With custom interval (default: 2000ms)
ts-node scripts/monitor-cline.ts --watch --last-n=15
```

### 4. Run the Orchestrator

The orchestrator monitors Cline and automatically generates analysis and recommendations:

```bash
# Start orchestration
ts-node scripts/orchestrate-cline.ts

# With custom check interval (default: 3000ms)
ts-node scripts/orchestrate-cline.ts --interval=5000

# With custom output directory
ts-node scripts/orchestrate-cline.ts --output=/path/to/output
```

## How It Works

### Monitoring

The monitor script reads Cline's task history from disk and parses:

- **Current task ID and description**
- **Recent chat messages** (asks, says, tool uses)
- **Token usage and cost**
- **Task status** (waiting, processing, completed, error, idle)

### Status Detection

The orchestrator analyzes the messages to determine Cline's state:

| Status | Description | Intervention Needed? |
|--------|-------------|---------------------|
| `waiting_for_input` | Cline asked a question and is waiting for response | ✅ YES |
| `error` | Cline encountered an error | ✅ YES |
| `completed` | Task appears to be done | ⚠️ VERIFY |
| `processing` | Cline is actively working | ❌ NO |
| `idle` | Cline has stopped but hasn't indicated completion | ⚠️ MAYBE |

### Decision Making

For each state change, the orchestrator:

1. **Analyzes** the context from recent messages
2. **Determines** the appropriate action
3. **Generates** a recommendation with confidence level
4. **Suggests** a response (if applicable)
5. **Creates** a prompt for Claude Code to review

### Output Files

The orchestrator creates several files in `.cline-orchestrator/` (or your custom output directory):

```
.cline-orchestrator/
├── decision-{timestamp}.json     # Timestamped decision records
├── latest-decision.json          # Most recent decision
├── suggested-response.txt        # Suggested response to paste into Cline
└── claude-prompt.md             # Detailed prompt for Claude Code review
```

## Integration with Claude Code

### Method 1: Manual Review

When the orchestrator detects that Cline needs intervention, it generates `claude-prompt.md`. Review it with Claude Code:

```bash
# Read the generated prompt
cat .cline-orchestrator/claude-prompt.md

# Or pipe it to Claude Code for analysis
cat .cline-orchestrator/claude-prompt.md | claude-code
```

Claude Code will analyze the situation and provide recommendations.

### Method 2: Automated Pipeline

Create a script that automatically feeds prompts to Claude Code:

```bash
#!/bin/bash
# watch-and-orchestrate.sh

ORCHESTRATOR_PID=""

# Start orchestrator in background
ts-node scripts/orchestrate-cline.ts &
ORCHESTRATOR_PID=$!

echo "Orchestrator running (PID: $ORCHESTRATOR_PID)"
echo "Monitoring for claude-prompt.md changes..."

# Watch for new prompts
while true; do
  if [ -f .cline-orchestrator/claude-prompt.md ]; then
    MODIFIED=$(stat -f %m .cline-orchestrator/claude-prompt.md 2>/dev/null || stat -c %Y .cline-orchestrator/claude-prompt.md)

    if [ "$MODIFIED" != "$LAST_MODIFIED" ]; then
      echo ""
      echo "═══════════════════════════════════════════════════════════════"
      echo "NEW PROMPT DETECTED - Asking Claude Code for analysis..."
      echo "═══════════════════════════════════════════════════════════════"

      # Send to Claude Code and display response
      cat .cline-orchestrator/claude-prompt.md | claude-code

      LAST_MODIFIED=$MODIFIED
    fi
  fi

  sleep 2
done

# Cleanup on exit
trap "kill $ORCHESTRATOR_PID 2>/dev/null" EXIT
```

Make it executable and run:

```bash
chmod +x watch-and-orchestrate.sh
./watch-and-orchestrate.sh
```

## Example Workflow

### Scenario: Cline asks if it should continue

1. **Cline asks**: "I found 15 type errors. Should I fix them all?"

2. **Monitor detects** the question and outputs state

3. **Orchestrator analyzes**:
   ```json
   {
     "taskStatus": "waiting_for_input",
     "analysis": "Cline is waiting for user input. Question: \"I found 15 type errors. Should I fix them all?\"",
     "recommendation": "Approve continuation",
     "suggestedResponse": "Yes, please continue.",
     "shouldContinue": true,
     "confidence": "high",
     "reasoning": "The question is asking for permission to continue, which can be automatically approved."
   }
   ```

4. **Claude Code reviews** the prompt and confirms the recommendation

5. **You paste** the suggested response into Cline's chat: "Yes, please continue."

6. **Cline continues** fixing all type errors

### Scenario: Cline encounters an error

1. **Cline says**: "Error: Module not found: 'missing-package'"

2. **Orchestrator detects** error state:
   ```json
   {
     "taskStatus": "error",
     "analysis": "Cline encountered an error. Last action: \"Error: Module not found: 'missing-package'\"",
     "recommendation": "Review error logs and recent messages to diagnose issue",
     "shouldContinue": false,
     "confidence": "high"
   }
   ```

3. **Claude Code analyzes** and suggests: "Install the missing package with: npm install missing-package"

4. **You provide guidance** to Cline: "Please run npm install missing-package first"

## Configuration

### Monitoring Interval

Adjust how often the orchestrator checks for changes:

```bash
# Check every 5 seconds (default: 3 seconds)
ts-node scripts/orchestrate-cline.ts --interval=5000
```

### Message History

Control how many recent messages to analyze:

```bash
# Show last 20 messages (default: 10)
ts-node scripts/monitor-cline.ts --last-n=20
```

### Output Location

Change where decisions are saved:

```bash
# Save to custom directory
ts-node scripts/orchestrate-cline.ts --output=/tmp/cline-decisions
```

## Advanced Usage

### Monitor Specific Task

If you have multiple tasks, monitor a specific one:

```bash
ts-node scripts/monitor-cline.ts --task-id=abc123-def456-...
```

### Programmatic Integration

Use the classes in your own scripts:

```typescript
import { ClineMonitor } from './scripts/monitor-cline'
import { ClineOrchestrator } from './scripts/orchestrate-cline'

const monitor = new ClineMonitor()

// Get state once
monitor.outputState({ lastN: 10, format: 'json' })

// Or start watching
monitor.watch({ lastN: 10, intervalMs: 2000 })

// Run orchestrator
const orchestrator = new ClineOrchestrator('/custom/output')
await orchestrator.run({ intervalMs: 3000 })
```

### Custom Decision Logic

Extend the `ClineOrchestrator` class to implement custom decision-making:

```typescript
class CustomOrchestrator extends ClineOrchestrator {
  protected async analyzeAndDecide(state: any): Promise<OrchestrationDecision> {
    // Your custom logic here
    const decision = await super.analyzeAndDecide(state)

    // Modify or enhance the decision
    if (state.taskDescription.includes('critical')) {
      decision.confidence = 'high'
      decision.shouldContinue = false
    }

    return decision
  }
}
```

## Troubleshooting

### "No active task found"

- Ensure Cline is running and has an active task
- Check that Cline's global storage path is correct (see `monitor-cline.ts` constructor)
- On Linux: `~/.config/Code/User/globalStorage/saoudrizwan.claude-dev/`
- On macOS: `~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/`
- On Windows: `%APPDATA%\Code\User\globalStorage\saoudrizwan.claude-dev\`

### Monitor not detecting changes

- Increase the monitoring interval
- Check that `taskHistory.json` is being updated by Cline
- Verify file permissions

### Orchestrator making incorrect decisions

- Review the `reasoning` field in decision output
- Adjust confidence thresholds
- Implement custom decision logic (see Advanced Usage)

## Best Practices

1. **Start with monitoring**: First, just watch what Cline does using the monitor script
2. **Review decisions manually**: Don't auto-approve until you trust the orchestrator's judgment
3. **Keep context**: Use `--last-n=20` or more to give Claude Code full context
4. **Save decisions**: Keep the decision history for debugging and improvement
5. **Customize for your workflow**: Extend the scripts for your specific needs

## Future Enhancements

Potential improvements to this system:

- **Auto-response**: Automatically paste responses into Cline (via clipboard or VS Code API)
- **Learning**: Track which decisions were correct and improve confidence scoring
- **Multi-task**: Monitor and orchestrate multiple concurrent Cline tasks
- **Webhook integration**: Trigger external systems when Cline needs help
- **LLM integration**: Directly call Claude API within orchestrator for real-time analysis

## License

Same as the Cline project.
