/**
 * Public Docs: https://cursor.com/docs/cli/acp#cursor-extension-methods
 * Additional reference provided by the Cursor team: https://anysphere.enterprise.slack.com/files/U068SSJE141/F0APT1HSZRP/cursor-acp-extension-method-schemas.md
 */
import type { UserInputQuestion } from "@t3tools/contracts";
import * as AcpSchema from "effect-acp/schema";
import * as Schema from "effect/Schema";

const CursorAskQuestionOption = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
});

const CursorAskQuestion = Schema.Struct({
  id: Schema.String,
  prompt: Schema.String,
  options: Schema.Array(CursorAskQuestionOption),
  allowMultiple: Schema.optional(Schema.Boolean),
});

export const CursorAskQuestionRequest = Schema.Struct({
  toolCallId: Schema.String,
  title: Schema.optional(Schema.String),
  questions: Schema.Array(CursorAskQuestion),
});

const CursorTodoStatus = Schema.String;

const CursorTodo = Schema.Struct({
  id: Schema.optional(Schema.String),
  content: Schema.optional(Schema.String),
  title: Schema.optional(Schema.String),
  status: Schema.optional(CursorTodoStatus),
});

const CursorPlanPhase = Schema.Struct({
  name: Schema.String,
  todos: Schema.Array(CursorTodo),
});

export const CursorCreatePlanRequest = Schema.Struct({
  toolCallId: Schema.String,
  name: Schema.optional(Schema.String),
  overview: Schema.optional(Schema.String),
  plan: Schema.String,
  todos: Schema.Array(CursorTodo),
  isProject: Schema.optional(Schema.Boolean),
  phases: Schema.optional(Schema.Array(CursorPlanPhase)),
});

export const CursorUpdateTodosRequest = Schema.Struct({
  toolCallId: Schema.String,
  todos: Schema.Array(CursorTodo),
  merge: Schema.Boolean,
});

/**
 * Cursor ACP `cursor/task` — documented as a fire-and-forget notification
 * about a subagent/shell task, but the CLI has also sent it as a request.
 * Only `toolCallId` is required so a completion-only payload still decodes.
 */
export const CursorTaskRequest = Schema.Struct({
  toolCallId: Schema.String,
  description: Schema.optional(Schema.String),
  prompt: Schema.optional(Schema.String),
  subagentType: Schema.optional(Schema.Unknown),
  model: Schema.optional(Schema.String),
  agentId: Schema.optional(Schema.String),
  durationMs: Schema.optional(Schema.Number),
});
export type CursorTaskRequest = typeof CursorTaskRequest.Type;

export const CursorTaskResponse = Schema.Struct({
  outcome: Schema.Union([
    Schema.Struct({
      outcome: Schema.Literal("completed"),
      agentId: Schema.optional(Schema.String),
      durationMs: Schema.optional(Schema.Number),
    }),
    Schema.Struct({
      outcome: Schema.Literal("rejected"),
      reason: Schema.optional(Schema.String),
    }),
    Schema.Struct({
      outcome: Schema.Literal("cancelled"),
    }),
  ]),
});
export type CursorTaskResponse = typeof CursorTaskResponse.Type;

const CursorAvailableModel = Schema.Struct({
  value: Schema.String,
  name: Schema.String,
  configOptions: Schema.optional(Schema.Array(AcpSchema.SessionConfigOption)),
});

export const CursorListAvailableModelsResponse = Schema.Struct({
  models: Schema.Array(CursorAvailableModel),
});

export function extractAskQuestions(
  params: typeof CursorAskQuestionRequest.Type,
): ReadonlyArray<UserInputQuestion> {
  return params.questions.map((question) => ({
    id: question.id,
    header: "Question",
    question: question.prompt,
    multiSelect: question.allowMultiple === true,
    options:
      question.options.length > 0
        ? question.options.map((option) => ({
            label: option.label,
            description: option.label,
          }))
        : [{ label: "OK", description: "Continue" }],
  }));
}

export function extractPlanMarkdown(params: typeof CursorCreatePlanRequest.Type): string {
  return params.plan || "# Plan\n\n(Cursor did not supply plan text.)";
}

export function extractTodosAsPlan(params: typeof CursorUpdateTodosRequest.Type): {
  readonly explanation?: string;
  readonly plan: ReadonlyArray<{
    readonly step: string;
    readonly status: "pending" | "inProgress" | "completed";
  }>;
} {
  const plan = params.todos.flatMap((todo) => {
    // Fall back to the title when content is missing OR blank. `??` only
    // covers a missing content, so a present-but-empty content ("" or
    // whitespace) would shadow a real title and drop the step below.
    const step = todo.content?.trim() || todo.title?.trim() || "";
    if (step === "") {
      return [];
    }
    const status: "pending" | "inProgress" | "completed" =
      todo.status === "completed"
        ? "completed"
        : todo.status === "in_progress" || todo.status === "inProgress"
          ? "inProgress"
          : "pending";
    return [{ step, status }];
  });
  return { plan };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Named Cursor subagent types that are watch loops, not Agents-panel work. */
const CURSOR_SHELL_SUBAGENT_TYPES: ReadonlySet<string> = new Set(["shell"]);

export function cursorSubagentTypeName(subagentType: unknown): string | undefined {
  if (typeof subagentType === "string") {
    const trimmed = subagentType.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (isRecord(subagentType) && typeof subagentType.custom === "string") {
    const trimmed = subagentType.custom.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  return undefined;
}

/**
 * `shell` maps onto T3's monitor bucket (`MONITOR_TASK_TYPES`). Every other
 * Cursor subagent type is left untyped so ingestion classifies it as an agent.
 */
export function cursorTaskTypeFromSubagent(subagentType: unknown): string | undefined {
  const name = cursorSubagentTypeName(subagentType);
  return name !== undefined && CURSOR_SHELL_SUBAGENT_TYPES.has(name) ? "shell" : undefined;
}

export function cursorTaskId(params: CursorTaskRequest): string {
  const agentId = params.agentId?.trim();
  if (agentId) {
    return agentId;
  }
  return params.toolCallId.trim();
}

export function cursorTaskTitle(params: CursorTaskRequest): string {
  return params.description?.trim() || params.prompt?.trim() || "Task";
}

/** `durationMs` is how Cursor marks a finished task on this notification. */
export function cursorTaskIsTerminal(params: CursorTaskRequest): boolean {
  return typeof params.durationMs === "number" && Number.isFinite(params.durationMs);
}

export function makeCursorTaskAck(params: CursorTaskRequest): CursorTaskResponse {
  const durationMs = params.durationMs;
  return {
    outcome: {
      outcome: "completed",
      ...(params.agentId?.trim() ? { agentId: params.agentId.trim() } : {}),
      ...(typeof durationMs === "number" && Number.isFinite(durationMs) ? { durationMs } : {}),
    },
  };
}
