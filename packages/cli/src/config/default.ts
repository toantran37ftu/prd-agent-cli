export const ROOT_FOLDER_TOKEN = "Xd7GfvPW7l0y5fdH1MEjPrbmpwh";
export const ROOT_FOLDER_URL =
  "https://zjpdeojgezgv.jp.larksuite.com/drive/folder/Xd7GfvPW7l0y5fdH1MEjPrbmpwh";

// v4: Cap constants
export const MAX_CRITIC_LOOPS = 2;
export const MAX_SUPERVISOR_TOOL_CALLS = 5;
export const MAX_LLM_CALLS_PER_RUN = 40;        // ngân sách thay cho cap verifier cứng =2
export const MAX_P0_RATIO = 0.6;                // L1-P0 threshold
export const HUMAN_GATE_REQUIRED = true;         // KHÔNG tắt được bằng flag

// Legacy (v3 compat)
export const MAX_VERIFIER_CALLS_PER_REVIEW = 2;

// Defaults
export const DEFAULT_REDIRECT_PORT = 3005;
export const DEFAULT_MODEL = "claude-sonnet-4-6";

// v4: Model per role
export const DEFAULT_MODELS = {
  cheap: "claude-haiku-4-5",     // Summarizer
  strong: "claude-sonnet-4-6",   // Reviewer, Writer, Critic, Change Planner, Supervisor
  verify: "claude-sonnet-4-6",   // Verifier (should differ from claim-sourcing model)
};
