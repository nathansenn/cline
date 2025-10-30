# Autonomous Cline Orchestration - Interaction Guide

This guide explains how to enable **fully autonomous** orchestration where Claude Code (via the orchestrator) can directly send responses to Cline without manual intervention.

## Overview

The autonomous orchestration system consists of:

1. **Protobus gRPC Service** - Runs inside Cline (VS Code extension)
2. **gRPC Client** - Connects to Cline and sends responses
3. **Autonomous Orchestrator** - Monitors Cline and automatically responds

## Architecture

```
┌──────────────────────────────────────────────────┐
│            Cline (VS Code Extension)              │
│                                                   │
│  ┌─────────────────────────────────────────────┐ │
│  │         Protobus gRPC Service                │ │
│  │         (Port 26040)                         │ │
│  └─────────────────┬───────────────────────────┘ │
└────────────────────┼──────────────────────────────┘
                     │
                     │ gRPC Connection
                     │ (AskResponseRequest)
                     │
┌────────────────────▼──────────────────────────────┐
│        Autonomous Orchestrator Script             │
│                                                   │
│  1. Monitor: Reads Cline's state                 │
│  2. Analyze: Determines what Cline needs         │
│  3. Decide: Makes decision with confidence       │
│  4. Respond: Sends response via gRPC             │
└───────────────────────────────────────────────────┘
```

## Setup

### Step 1: Enable Protobus Service in Cline

The protobus service needs to be enabled in Cline's VS Code extension. There are two ways to do this:

#### Option A: Using VS Code Settings (Recommended)

1. Open VS Code
2. Open Command Palette (Cmd+Shift+P / Ctrl+Shift+P)
3. Run: `Preferences: Open Settings (JSON)`
4. Add this setting:

```json
{
  "cline.enableProtobusService": true
}
```

5. Reload VS Code window or restart

#### Option B: Programmatically (for testing)

```typescript
// In VS Code extension or debug console
vscode.workspace.getConfiguration().update('cline.enableProtobusService', true, true)
```

### Step 2: Verify Service is Running

Check that the protobus service started:

1. Open VS Code Output panel (View → Output)
2. Select "Cline" from the dropdown
3. Look for: `Protobus gRPC service started at 127.0.0.1:26040`

If you don't see this message, the service may not have started. Check the error logs.

### Step 3: Test gRPC Connection

Test that you can connect to the service:

```bash
npx ts-node --project scripts/tsconfig.json scripts/cline-grpc-client.ts --help
```

This should show the help message. If you get a connection error, the service isn't running.

## Usage

### Manual Response Sending

Send responses to Cline manually using the gRPC client:

```bash
# Send a text message
npx ts-node --project scripts/tsconfig.json scripts/cline-grpc-client.ts "Yes, please continue"

# Send a "Yes" button click
npx ts-node --project scripts/tsconfig.json scripts/cline-grpc-client.ts --yes

# Send a "No" button click
npx ts-node --project scripts/tsconfig.json scripts/cline-grpc-client.ts --no

# Send specific instructions
npx ts-node --project scripts/tsconfig.json scripts/cline-grpc-client.ts "Fix the type errors in src/utils.ts first"
```

### Autonomous Orchestration

Run the autonomous orchestrator to have it automatically respond to Cline:

```bash
# Run with high confidence threshold (safest)
npx ts-node --project scripts/tsconfig.json scripts/autonomous-orchestrator.ts

# Allow medium confidence auto-responses
npx ts-node --project scripts/tsconfig.json scripts/autonomous-orchestrator.ts --confidence=medium

# Allow all auto-responses (use with caution!)
npx ts-node --project scripts/tsconfig.json scripts/autonomous-orchestrator.ts --confidence=low

# Monitor only, no auto-response
npx ts-node --project scripts/tsconfig.json scripts/autonomous-orchestrator.ts --no-grpc
```

### Confidence Levels

The orchestrator assigns confidence levels to its decisions:

| Level | Description | When Used |
|-------|-------------|-----------|
| **high** | Very confident in the response | Simple approval questions, "Should I continue?" |
| **medium** | Moderately confident | General questions, unclear intent |
| **low** | Not confident | Complex decisions, error handling, open-ended questions |

**Recommendation**: Start with `--confidence=high` and only lower it once you trust the system.

## How It Works

### Decision-Making Process

1. **Monitor**: Read Cline's task state from disk
2. **Detect Change**: Task status changed or new message received
3. **Analyze Context**: Review recent messages and current status
4. **Determine Action**: Based on the question/situation, decide what to do
5. **Assign Confidence**: How sure are we this is the right action?
6. **Send Response**: If confidence ≥ threshold, send via gRPC
7. **Log Decision**: Save decision to file for review

### Example Flow

**Scenario**: Cline asks "I found 15 type errors. Should I fix them all?"

```
┌─────────────────────────────────────────────────┐
│ 1. Monitor detects new message                  │
│    Status: waiting_for_input                    │
│    Question: "Should I fix them all?"           │
└────────────────┬────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────┐
│ 2. Orchestrator analyzes                        │
│    - Question contains "should I"               │
│    - Asking for permission to proceed           │
│    - Type errors are routine                    │
└────────────────┬────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────┐
│ 3. Makes decision                               │
│    Recommendation: Approve continuation         │
│    Suggested Response: "Yes, please continue."  │
│    Confidence: HIGH                             │
│    Reasoning: Permission question, safe to OK   │
└────────────────┬────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────┐
│ 4. Checks threshold                             │
│    Required: HIGH                               │
│    Decision: HIGH                               │
│    Result: THRESHOLD MET ✓                      │
└────────────────┬────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────┐
│ 5. Sends response via gRPC                      │
│    askResponse({                                │
│      responseType: "messageResponse",           │
│      text: "Yes, please continue."              │
│    })                                           │
└────────────────┬────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────┐
│ 6. Cline receives and continues                 │
│    Task resumes execution                       │
│    Fixes all 15 type errors                     │
└─────────────────────────────────────────────────┘
```

## Output Files

All decisions are logged to `.cline-orchestrator/`:

```
.cline-orchestrator/
├── latest-decision.json          # Most recent decision
├── suggested-response.txt        # Last suggested response
└── decision-{timestamp}.json     # Historical decisions
```

### Decision File Format

```json
{
  "timestamp": "2025-10-30T10:30:15.000Z",
  "taskId": "abc123-def456",
  "taskStatus": "waiting_for_input",
  "analysis": "Cline is waiting for user input. Question: \"Should I fix them all?\"",
  "recommendation": "Approve continuation",
  "suggestedResponse": "Yes, please continue.",
  "shouldContinue": true,
  "confidence": "high",
  "reasoning": "The question is asking for permission to continue.",
  "autoResponseSent": true
}
```

## Safety Features

### Confidence Thresholds

Only send auto-responses when confidence meets the threshold:

- `--confidence=high`: Only very clear, safe decisions (recommended)
- `--confidence=medium`: Include moderately confident decisions
- `--confidence=low`: Send all responses (not recommended)

### Decision Logging

Every decision is logged with:
- Timestamp
- Full analysis
- Reasoning
- Whether response was sent

Review logs regularly to ensure the orchestrator is making good decisions.

### Manual Override

You can always:
1. Stop the orchestrator (Ctrl+C)
2. Review the latest decision
3. Manually respond to Cline if needed

## Troubleshooting

### "Failed to connect to Cline protobus service"

**Cause**: Protobus service not running in Cline

**Solutions**:
1. Verify service is enabled in VS Code settings
2. Reload VS Code window
3. Check Cline output logs for errors
4. Try restarting VS Code

### "gRPC service not available"

**Cause**: Can't connect to port 26040

**Solutions**:
1. Check if another process is using port 26040: `lsof -i :26040`
2. Try custom port: `CLINE_GRPC_PORT=26041 npx ts-node ...`
3. Check firewall settings
4. Ensure Cline extension is running

### Auto-response not working

**Cause**: Various reasons

**Debugging**:
1. Check orchestrator logs - does it say "Response sent successfully"?
2. Check confidence level - is it high enough?
3. Verify gRPC connection works with manual test
4. Look for errors in Cline output logs

### Orchestrator sending wrong responses

**Cause**: Decision logic needs tuning

**Solutions**:
1. Lower confidence threshold to `--confidence=medium` or `--confidence=low`
2. Review recent decisions in `.cline-orchestrator/`
3. Modify `analyzeAndDecide()` logic in `autonomous-orchestrator.ts`
4. Add custom decision rules for your use case

## Advanced Usage

### Custom Decision Logic

Extend the orchestrator to customize decision-making:

```typescript
import { AutonomousOrchestrator } from './scripts/autonomous-orchestrator'

class CustomOrchestrator extends AutonomousOrchestrator {
  protected async analyzeAndDecide(state: any) {
    const decision = await super.analyzeAndDecide(state)

    // Add custom logic
    if (state.taskDescription.includes('production')) {
      decision.confidence = 'low' // Always require review for production changes
    }

    if (state.waitingOn?.includes('delete')) {
      decision.confidence = 'low' // Be careful with deletions
      decision.shouldContinue = false
    }

    return decision
  }
}
```

### Integration with CI/CD

Run the orchestrator in CI pipelines:

```bash
#!/bin/bash
# Start orchestrator in background
npx ts-node --project scripts/tsconfig.json scripts/autonomous-orchestrator.ts --confidence=high &
ORCHESTRATOR_PID=$!

# Start Cline task
# ... your Cline automation ...

# Wait for completion
wait $ORCHESTRATOR_PID
```

### Monitoring Multiple Cline Instances

Run multiple orchestrators with different ports:

```bash
# Terminal 1: Cline instance 1 (port 26040)
CLINE_GRPC_PORT=26040 npx ts-node --project scripts/tsconfig.json scripts/autonomous-orchestrator.ts

# Terminal 2: Cline instance 2 (port 26041)
CLINE_GRPC_PORT=26041 npx ts-node --project scripts/tsconfig.json scripts/autonomous-orchestrator.ts
```

## Best Practices

1. **Start with high confidence**: Use `--confidence=high` until you trust the system
2. **Review decisions regularly**: Check `.cline-orchestrator/` logs
3. **Test in safe environments**: Don't use on production code initially
4. **Monitor the first few runs**: Watch what decisions are made
5. **Customize for your workflow**: Modify decision logic as needed
6. **Keep backups**: Use version control before autonomous runs
7. **Set up alerts**: Monitor for unexpected behavior

## Example Workflows

### Workflow 1: Supervised Autonomous Mode

Let the orchestrator handle routine questions but review decisions:

```bash
# Terminal 1: Run orchestrator
npx ts-node --project scripts/tsconfig.json scripts/autonomous-orchestrator.ts --confidence=high

# Terminal 2: Watch decisions
watch -n 2 cat .cline-orchestrator/latest-decision.json
```

### Workflow 2: Fully Autonomous

Let it run completely hands-off:

```bash
# Start and forget
npx ts-node --project scripts/tsconfig.json scripts/autonomous-orchestrator.ts --confidence=medium > orchestrator.log 2>&1 &

# Check on it later
tail -f orchestrator.log
```

### Workflow 3: Human-in-the-Loop

Monitor but don't auto-respond:

```bash
# Monitor only
npx ts-node --project scripts/tsconfig.json scripts/autonomous-orchestrator.ts --no-grpc

# When you see a decision, manually send it
npx ts-node --project scripts/tsconfig.json scripts/cline-grpc-client.ts "$(cat .cline-orchestrator/suggested-response.txt)"
```

## Performance Considerations

### Check Interval

- **3000ms (default)**: Good balance
- **1000ms**: More responsive, higher CPU
- **5000ms**: Less responsive, lower CPU

### Resource Usage

- Minimal CPU when idle
- Reads `taskHistory.json` every check
- gRPC connection is persistent
- Decision logging uses disk I/O

## Security Considerations

1. **gRPC Security**: Currently uses insecure credentials (localhost only)
2. **File Access**: Reads Cline's task history (user's data)
3. **Auto-Response**: Can send arbitrary responses to Cline
4. **Logging**: Decisions may contain sensitive information

**Recommendations**:
- Only run on trusted machines
- Review auto-responses for your use case
- Don't expose gRPC port externally
- Protect decision logs if they contain secrets

## Future Enhancements

Planned features:

- [ ] Web UI dashboard for monitoring
- [ ] Slack/Discord notifications
- [ ] Learning from past decisions
- [ ] Multi-agent orchestration
- [ ] Response templates
- [ ] Rollback capabilities
- [ ] Integration with Claude API for smarter decisions

## Contributing

Have ideas for improving the orchestration system?

1. Test your changes
2. Add tests if applicable
3. Update documentation
4. Submit a pull request

---

**Happy orchestrating!** 🤖 Let the autonomous system supervise Cline while you focus on building.
