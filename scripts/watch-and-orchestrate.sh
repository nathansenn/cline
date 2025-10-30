#!/bin/bash

# Cline Orchestrator with Claude Code Integration
# This script monitors Cline and automatically sends prompts to Claude Code when intervention is needed

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
OUTPUT_DIR="${PROJECT_ROOT}/.cline-orchestrator"
CHECK_INTERVAL=3

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Parse arguments
WATCH_MODE="auto"
INTERVAL=3000

while [[ $# -gt 0 ]]; do
  case $1 in
    --manual)
      WATCH_MODE="manual"
      shift
      ;;
    --auto)
      WATCH_MODE="auto"
      shift
      ;;
    --interval=*)
      INTERVAL="${1#*=}"
      shift
      ;;
    --help)
      echo "Cline Orchestrator with Claude Code Integration"
      echo ""
      echo "Usage: $0 [OPTIONS]"
      echo ""
      echo "Options:"
      echo "  --manual          Manual mode: show prompts but don't auto-send to Claude Code"
      echo "  --auto            Auto mode: automatically send prompts to Claude Code (default)"
      echo "  --interval=MS     Check interval in milliseconds (default: 3000)"
      echo "  --help            Show this help message"
      echo ""
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      echo "Use --help for usage information"
      exit 1
      ;;
  esac
done

echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}           CLINE ORCHESTRATOR + CLAUDE CODE${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "Mode:              ${GREEN}${WATCH_MODE}${NC}"
echo -e "Check Interval:    ${GREEN}${INTERVAL}ms${NC}"
echo -e "Output Directory:  ${GREEN}${OUTPUT_DIR}${NC}"
echo ""
echo -e "${YELLOW}Press Ctrl+C to stop${NC}"
echo ""

# Create output directory if it doesn't exist
mkdir -p "$OUTPUT_DIR"

# Track last modification time
LAST_MODIFIED=""
LAST_DECISION_TIME=0

# Cleanup function
cleanup() {
  echo ""
  echo -e "${YELLOW}Shutting down orchestrator...${NC}"
  if [ -n "$ORCHESTRATOR_PID" ]; then
    kill $ORCHESTRATOR_PID 2>/dev/null || true
  fi
  exit 0
}

trap cleanup SIGINT SIGTERM

# Start the orchestrator in the background
echo -e "${BLUE}Starting orchestrator...${NC}"
cd "$PROJECT_ROOT"
npx ts-node --project scripts/tsconfig.json scripts/orchestrate-cline.ts --interval=$INTERVAL --output="$OUTPUT_DIR" &
ORCHESTRATOR_PID=$!

echo -e "${GREEN}Orchestrator running (PID: $ORCHESTRATOR_PID)${NC}"
echo ""

# Wait for orchestrator to initialize
sleep 2

# Check if orchestrator is still running
if ! kill -0 $ORCHESTRATOR_PID 2>/dev/null; then
  echo -e "${RED}ERROR: Orchestrator failed to start${NC}"
  exit 1
fi

echo -e "${BLUE}Monitoring for Cline activity...${NC}"
echo ""

# Main monitoring loop
while true; do
  # Check if orchestrator is still running
  if ! kill -0 $ORCHESTRATOR_PID 2>/dev/null; then
    echo -e "${RED}ERROR: Orchestrator stopped unexpectedly${NC}"
    exit 1
  fi

  # Check if there's a new decision
  if [ -f "$OUTPUT_DIR/latest-decision.json" ]; then
    # Get modification time based on OS
    if [[ "$OSTYPE" == "darwin"* ]]; then
      MODIFIED=$(stat -f %m "$OUTPUT_DIR/latest-decision.json" 2>/dev/null || echo "0")
    else
      MODIFIED=$(stat -c %Y "$OUTPUT_DIR/latest-decision.json" 2>/dev/null || echo "0")
    fi

    # Check if it's a new decision
    if [ "$MODIFIED" != "$LAST_MODIFIED" ] && [ "$MODIFIED" -gt "$LAST_DECISION_TIME" ]; then
      LAST_MODIFIED=$MODIFIED
      LAST_DECISION_TIME=$MODIFIED

      # Read the decision
      DECISION=$(cat "$OUTPUT_DIR/latest-decision.json")
      NEEDS_INTERVENTION=$(echo "$DECISION" | grep -o '"needsIntervention":[^,}]*' | cut -d':' -f2 | tr -d ' ')
      STATUS=$(echo "$DECISION" | grep -o '"taskStatus":"[^"]*"' | cut -d'"' -f4)
      RECOMMENDATION=$(echo "$DECISION" | grep -o '"recommendation":"[^"]*"' | cut -d'"' -f4)

      echo ""
      echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
      echo -e "${YELLOW}NEW DECISION DETECTED${NC}"
      echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
      echo -e "Time:             $(date)"
      echo -e "Status:           ${YELLOW}${STATUS}${NC}"
      echo -e "Needs Action:     ${NEEDS_INTERVENTION}"
      echo -e "Recommendation:   ${RECOMMENDATION}"
      echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
      echo ""

      # Show suggested response if available
      if [ -f "$OUTPUT_DIR/suggested-response.txt" ]; then
        SUGGESTED=$(cat "$OUTPUT_DIR/suggested-response.txt")
        echo -e "${GREEN}Suggested Response:${NC}"
        echo -e "${GREEN}\"${SUGGESTED}\"${NC}"
        echo ""
      fi

      # Check if Claude Code prompt exists
      if [ -f "$OUTPUT_DIR/claude-prompt.md" ]; then
        if [ "$WATCH_MODE" == "auto" ]; then
          echo -e "${BLUE}Sending to Claude Code for analysis...${NC}"
          echo ""
          echo -e "${BLUE}─────────────────────────────────────────────────────────────${NC}"

          # Send to Claude Code
          # Note: This assumes 'claude' or 'claude-code' is in PATH
          # Adjust the command based on your Claude Code installation
          if command -v claude &> /dev/null; then
            cat "$OUTPUT_DIR/claude-prompt.md" | claude
          elif command -v claude-code &> /dev/null; then
            cat "$OUTPUT_DIR/claude-prompt.md" | claude-code
          else
            echo -e "${YELLOW}WARNING: Claude Code CLI not found in PATH${NC}"
            echo -e "${YELLOW}Please install Claude Code or run manually:${NC}"
            echo ""
            echo -e "  cat $OUTPUT_DIR/claude-prompt.md | claude"
            echo ""
          fi

          echo -e "${BLUE}─────────────────────────────────────────────────────────────${NC}"
        else
          echo -e "${YELLOW}Manual mode: Review the prompt yourself${NC}"
          echo ""
          echo -e "To analyze with Claude Code, run:"
          echo -e "  ${GREEN}cat $OUTPUT_DIR/claude-prompt.md | claude${NC}"
          echo ""
          echo -e "Or view the prompt:"
          echo -e "  ${GREEN}cat $OUTPUT_DIR/claude-prompt.md${NC}"
          echo ""
        fi
      fi

      echo -e "${BLUE}Waiting for next decision...${NC}"
      echo ""
    fi
  fi

  sleep $CHECK_INTERVAL
done
