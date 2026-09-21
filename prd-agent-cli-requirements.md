# PRD Agent CLI — Requirement Specification (Dev Phase)

> Input cho coding agent (Claude Code / Codex). Setup phía Lark (app, permissions, folder ACL) đã xong — tài liệu này chỉ cover phần code.
>
> **v3 update:** kiến trúc agent đổi từ fixed pipeline sang **Task-Orchestrator** (mỗi command có 1 orchestrator riêng, tự quyết định có gọi Critic/Verifier hay không, có cap vòng lặp) + thêm **Supervisor agent** cho path điều hướng tự do (`prdcli agent "..."`), tái sử dụng lại đúng các Task-Orchestrator đã có, không duplicate logic.

---

## 0. Bối cảnh & Mục tiêu

Xây 1 CLI nội bộ, mỗi thành viên team tự cài và chạy bằng tài khoản Lark cá nhân (mail công ty). CLI cho phép:
- Sync toàn bộ tài liệu (docx, bitable, sheet, wiki) trong 1 project (= 1 sub-folder trong root folder cố định) về cache local.
- Chạy các agent (review PRD, sinh câu hỏi cần hỏi đối tác, soạn PRD draft) dựa trên context đã sync, có cơ chế tự soát lẫn nhau (Critic/Verifier) thay vì tin 1 lần chạy duy nhất.
- Ghi lại memory (quyết định đã chốt, câu hỏi mở, tóm tắt tài liệu) — lưu local **và** đẩy ngược lên 1 sub-folder trong chính project đó trên Lark để nhiều thành viên share chung.
- Không khoá cứng vào 1 model/runtime (multi-channel: builtin / claude-code / codex / generic-mcp-export).
- Hỗ trợ **2 cách gọi**: theo command cụ thể (deterministic routing) **và** theo câu lệnh tự nhiên qua 1 Supervisor agent tự điều hướng.

Không làm ở giai đoạn này: server/gateway riêng, web UI, multi-tenant phức tạp.

---

## 1. Root scope — ràng buộc bắt buộc

**Root folder (cố định, hard-code trong CLI, không cho override qua tham số người dùng):**
```
https://zjpdeojgezgv.jp.larksuite.com/drive/folder/Xd7GfvPW7l0y5fdH1MEjPrbmpwh
root_folder_token = Xd7GfvPW7l0y5fdH1MEjPrbmpwh
```

Yêu cầu:
- Mỗi sub-folder cấp 1 ngay dưới root = 1 project độc lập. CLI tự liệt kê được danh sách này (`prdcli project list`).
- **Guard bắt buộc ở tầng code** (`prdcli-tools-mcp`, không chỉ dựa vào ACL Lark): mọi tool đọc/ghi phải kiểm tra `node_id` đích nằm trong cây con `root_folder_token` trước khi gọi API thật. Reject + log rõ nếu không, không gọi Lark. Đây là phòng thủ trước prompt injection từ nội dung doc, và trước quyết định sai của Supervisor agent (mục 3).
- Mọi tool ghi chỉ target đúng project đang active, không ghi chéo sang project khác trong cùng root.

---

## 2. Kiến trúc Agent — Task-Orchestrator + Critic/Verifier (thay fixed pipeline)

### 2.1 Vấn đề với pipeline cứng (bản v1/v2)
Chạy `Summarizer → Reviewer / Question-gen / Writer` độc lập, không ai kiểm tra output của agent khác → rủi ro hallucination không bị bắt, Reviewer/Question-gen chạy song song dễ trùng lặp/thiếu liên kết.

### 2.2 Thiết kế mới: mỗi task có 1 Orchestrator riêng, tự quyết định gọi sub-agent nào

**Task-Orchestrator cho `review`:**
```
ReviewOrchestrator(project, targetDoc)
  tools: call_reviewer(), call_verifier(claims)
  logic (do model tự quyết định trong prompt, không hard-code if/else):
    1. Gọi Reviewer → nhận list claims (gaps/risks/recommendations, mỗi claim gắn node_id nguồn)
    2. Tự đánh giá: claim nào cần verify (thường là claim quan trọng/risk cao) → gọi Verifier
       Verifier: đối chiếu claim với read_cached_doc(node_id), trả "confirmed" / "not found in source"
    3. Claim không verify được → gắn nhãn "chưa xác nhận nguồn" trong output cuối, không xoá
    4. Trả kết quả cuối cùng (đã gắn nhãn rõ claim nào verified)
  cap: tối đa 2 lượt gọi Verifier trong 1 lần review (tránh verify tràn lan tốn token)
```

**Task-Orchestrator cho `ask`:**
```
AskOrchestrator(project, targetDoc)
  tools: call_reviewer_output_if_available(), call_question_gen()
  logic:
    1. Nếu đã có review gần nhất cho đúng targetDoc (check .prdcli/runs/) → dùng lại làm input
       Nếu chưa có → tự gọi ReviewOrchestrator trước (đảm bảo Question-gen có gap/risk để bám vào,
       tránh hỏi trùng/hời hợt — đúng pattern "Reviewer → Question-gen tuần tự" đã chốt)
    2. Gọi Question Generator với context = review output + summaries + project_memory
    3. Ghi câu hỏi mới vào project_memory.md (Open Questions), pushMemory()
```

**Task-Orchestrator cho `draft`:**
```
DraftOrchestrator(project, topic)
  tools: call_writer(), call_critic(draft)
  logic:
    1. Gọi Writer → nhận draft PRD
    2. Tự đánh giá draft có cần Critic không (draft dài/nhiều claim cụ thể → nên gọi;
       draft ngắn/rõ ràng → có thể bỏ qua) — quyết định này do model tự làm trong prompt
    3. Nếu gọi Critic: Critic đối chiếu từng claim trong draft với cached docs/summaries +
       checklist PRD chuẩn (agents/prompts/prd-template.md) → trả feedback cụ thể (thiếu section nào,
       claim nào không có nguồn)
    4. Nếu Critic có feedback nghiêm trọng → gọi lại Writer revise theo feedback
    5. Lặp tối đa N=2 vòng Writer↔Critic; hết cap mà Critic vẫn chưa approve →
       xuất bản kèm flag "cần người review thủ công" thay vì tự publish im lặng
```

### 2.3 Agent list đầy đủ (vai trò đơn, không tự orchestrate)

| Agent | System prompt | Vai trò |
|---|---|---|
| Summarizer | `agents/prompts/summarizer.md` | Tóm tắt 1 doc, dùng trong `sync` |
| Reviewer | `agents/prompts/reviewer.md` | Sinh claims (gap/risk/recommendation), mỗi claim gắn nguồn |
| Verifier | `agents/prompts/verifier.md` | Đối chiếu 1 claim với cached doc, trả confirmed/not-found |
| Question Generator | `agents/prompts/question-gen.md` | Sinh câu hỏi cần hỏi đối tác, dựa trên review output |
| Writer | `agents/prompts/writer.md` | Soạn PRD draft theo template chuẩn |
| Critic | `agents/prompts/critic.md` | Đối chiếu draft của Writer với nguồn + checklist, trả feedback |

Các agent này **không có quyền gọi lẫn nhau trực tiếp** — chỉ Orchestrator tương ứng mới có tool access tới chúng. Điều này giữ logic nghiệp vụ (khi nào cần Critic, cap bao nhiêu vòng) tập trung ở 1 nơi (Orchestrator), không rải rác.

---

## 3. Supervisor agent — điều hướng tự do (path `prdcli agent "..."`)

### 3.1 Hai đường vào, route bằng code (deterministic ở tầng ngoài)

```
prdcli review <doc>     ─┐
prdcli ask <doc>         ├─→ code gọi thẳng đúng Task-Orchestrator tương ứng (mục 2.2)
prdcli draft --topic ... ┘   không tốn model để routing vì intent đã rõ từ command

prdcli agent "<câu lệnh tự nhiên>"  ─→ Supervisor agent tự điều hướng
```

### 3.2 Supervisor không viết lại logic — chỉ gọi lại các Task-Orchestrator đã có

```
Supervisor agent
  tools: run_sync(), run_review(doc), run_ask(doc), run_draft(topic),
         list_projects(), read_project_memory(), read_summaries()
  nhiệm vụ:
    1. Đọc câu lệnh tự nhiên, xác định project (nếu chưa active → hỏi lại hoặc gợi ý list_projects())
    2. Xác định cần chạy task nào trong {sync, review, ask, draft}, thứ tự gì
       (VD: "check PRD A thiếu gì, xong hỏi luôn đối tác" → run_review() trước,
        dùng output làm ngữ cảnh, rồi run_ask())
    3. Có thể gọi nhiều task nối tiếp nếu câu lệnh yêu cầu nhiều việc
  KHÔNG có prompt riêng để tự làm review/draft — mọi việc thực thi thật đều đi qua
  đúng Task-Orchestrator ở mục 2.2, đảm bảo Critic/Verifier/cap vòng lặp vẫn áp dụng
  y hệt dù gọi từ Supervisor hay từ command trực tiếp.
```

### 3.3 Guardrail bắt buộc cho path Supervisor (vì đây là phần non-deterministic)

- Cap tối đa **5 tool-call** (tức tối đa 5 lần gọi task) trong 1 lần chạy Supervisor — chặn loop lan man/hiểu sai ý gọi tràn lan.
- Mọi action ghi (push comment, push draft lên Lark, ghi project_memory) **vẫn phải confirm y/n**, không có ngoại lệ cho path Supervisor.
- Scope-guard ở `prdcli-tools-mcp` (mục 1) là lớp chặn cuối, áp dụng như nhau bất kể Supervisor hay command gọi vào.
- Ghi lại **trace quyết định** của Supervisor (chọn gọi task nào, vì sao — lấy từ reasoning/tool-call log) vào `.prdcli/runs/<timestamp>_agent-trace.md`, phục vụ debug vì đây là phần khó debug nhất trong hệ thống (non-deterministic).
- Nếu Supervisor không xác định được project từ câu lệnh → phải hỏi lại user (interactive prompt), không tự đoán đại 1 project.

---

## 3.5 Structured Message Pool — lấy cảm hứng từ MetaGPT (SOP + publish/subscribe)

**Vấn đề của thiết kế trước**: Orchestrator gọi sub-agent qua tool call ad-hoc, tự nhớ trạng thái bằng cách đọc file `.prdcli/runs/` — không có format thống nhất, khó biết "đã có review cho doc này chưa, còn mới không" một cách chắc chắn, và mỗi Orchestrator tự implement lại kiểu check này.

**Cải tiến (theo MetaGPT)**: MetaGPT không để agent giao tiếp qua hội thoại tự do — mọi output đều là 1 "document" chuẩn hoá (PRD, design doc, task list...), và agent khác chỉ đọc đúng loại document mình cần (publish/subscribe), không đọc lại toàn bộ lịch sử. Áp dụng nguyên lý này vào hệ thống:

### 3.5.1 Message Pool
Mọi output của agent (không chỉ Writer) đều là 1 **message có type cố định**, lưu tại `.prdcli/messages/<project>/<type>__<target_doc_or_topic>.json`:
```json
{
  "id": "msg_xxx",
  "type": "review_result | question_list | draft_prd | critic_feedback | doc_summary",
  "project": "project-A",
  "target_doc_node_id": "...",          // null nếu type=draft_prd (chưa có doc thật)
  "produced_by": "reviewer|verifier|question-gen|writer|critic|summarizer",
  "based_on_hash": "sha256 của target_doc lúc tạo message này",  // để biết message có "stale" chưa
  "created_at": "...",
  "content": { ... },                    // đúng schema output của agent tương ứng (mục 2, 7-9)
  "supersedes": "msg_id cũ nếu đây là bản revise (VD: draft_prd sau khi Writer revise theo Critic)"
}
```

### 3.5.2 Publish / Subscribe thay cho "gọi thẳng tool"
Mỗi Role Card (mục agent-prompts, xem file companion) khai báo rõ:
- **Watch**: loại message role này cần đọc trước khi chạy (VD: Question Generator watch `review_result`).
- **Publish**: loại message role này tạo ra sau khi chạy.

Orchestrator, trước khi gọi 1 role, luôn check Message Pool: nếu đã có message đúng type, đúng `target_doc_node_id`, và `based_on_hash` khớp hash hiện tại của doc (tức doc chưa đổi từ lúc có message đó) → **dùng lại, không chạy lại role**. Đây là cơ chế chống lặp/tốn token chắc chắn hơn cách cũ (đọc `runs/` bằng heuristic).

### 3.5.3 Lợi ích cụ thể cho hệ thống này
- `AskOrchestrator` không cần tự đoán "có review gần đây không" nữa — chỉ query message pool theo `type=review_result, target_doc_node_id=X, based_on_hash=<hash hiện tại>`.
- `Supervisor` (mục 3) có thể tự kiểm tra trạng thái project (đã review gì, đã hỏi gì, đã có draft nào) bằng cách list message pool, thay vì phải tự suy luận qua hội thoại.
- Message pool tự nhiên là **audit trail đầy đủ theo doc/theo loại việc**, tách biệt khỏi `.prdcli/runs/` (vốn là log theo lần chạy command, không phải theo trạng thái nghiệp vụ).

### 3.5.4 Role Card format (áp dụng cho mọi agent trong file `agent-prompts-and-workflows.md`)
Mỗi prompt agent giờ khai báo thêm 4 trường chuẩn ở đầu (giống cách MetaGPT định nghĩa role qua Profile/Goal/Constraints/Actions):
```
- Profile: <tên vai trò, mô tả 1 câu>
- Goal: <mục tiêu duy nhất của role này>
- Constraints: <giới hạn bắt buộc — không bịa, luôn gắn nguồn, không tự ý ghi ngoài phạm vi...>
- Watch: <message type(s) cần đọc trước khi chạy>
- Publish: <message type tạo ra sau khi chạy>
```

---

## 4. Multi-channel / Runtime-agnostic

Vấn đề: không khoá cứng vào 1 SDK/model. Giải pháp: tách "khả năng" (tools) khỏi "runtime chạy model", expose qua MCP chuẩn.

### 4.1 Hai lớp tool, đều là MCP server độc lập
- `lark-mcp` (chính chủ Lark) — thao tác Lark thô.
- `prdcli-tools-mcp` (tự build) — bọc cache/memory/scope-guard (mục 1) + tool điều phối cho Orchestrator/Supervisor: `read_cached_doc`, `read_summaries`, `read_project_memory`, `write_project_memory`, `list_projects`, `scoped_create_docx`, `scoped_update_docx`, `run_sync`, `run_review`, `run_ask`, `run_draft` (2 tool cuối này chính là entrypoint mà cả CLI command lẫn Supervisor cùng gọi vào — 1 nguồn logic duy nhất).

### 4.2 Các kênh chạy

| Channel | Cách hoạt động | Ưu tiên |
|---|---|---|
| `builtin` (mặc định) | CLI tự orchestrate bằng Claude Agent SDK, dùng 2 MCP server trên. Đầy đủ tính năng nhất — bao gồm cả Supervisor. | Phải có ở v1 |
| `claude-code` | Sinh `.mcp.json` + `.claude/agents/*.md` (bao gồm cả Orchestrator/Supervisor dưới dạng subagent Claude Code), user tự chạy trong Claude Code. | Phải có ở v1 |
| `codex` | Tương tự, format Codex CLI (kiểm tra format hiện hành lúc code). | V1.1 |
| `generic-mcp-export` | Export raw `mcpServers` JSON + toàn bộ prompt trong `agents/prompts/`. | Fallback, nice-to-have |

### 4.3 Interface bắt buộc trong code

```ts
// src/runtime/types.ts
interface AgentRunInput {
  agentName: "supervisor" | "review-orchestrator" | "ask-orchestrator" | "draft-orchestrator";
  projectToken: string;
  targetDocToken?: string;
  freeTextGoal?: string;   // dùng khi agentName = "supervisor"
  extraArgs?: Record<string, unknown>;
}

interface AgentRunResult {
  output: string;
  toolCallsLog: ToolCall[];
  needsManualReview?: boolean;   // true khi Critic hết cap mà chưa approve (mục 2.2)
}

interface AgentRuntime {
  run(input: AgentRunInput): Promise<AgentRunResult>;
}
```
- `BuiltinClaudeRuntime implements AgentRuntime` — channel `builtin`.
- Channel còn lại implement `ConfigExporter` (chỉ sinh config, không tự chạy model).

---

## 5. Tech stack

- Runtime: Node.js (>=20) + TypeScript.
- Agent orchestration (channel `builtin`): `@anthropic-ai/claude-agent-sdk`.
- MCP server tự build (`prdcli-tools-mcp`): `@modelcontextprotocol/sdk`, độc lập Claude Agent SDK để channel khác cũng dùng thẳng được.
- Lark connector: `@larksuiteoapi/lark-mcp`, mode `stdio`.
- CLI framework: `commander` hoặc `yargs`.
- Local storage: file system thuần (JSON/Markdown).
- Distribution: npm registry nội bộ hoặc git repo + `npm link`.

---

## 6. Cấu trúc repo

```
prd-agent-cli/
  packages/
    tools-mcp/                    # prdcli-tools-mcp
      src/
        server.ts
        scope-guard.ts            # mục 1
        orchestrators/
          review-orchestrator.ts  # logic mục 2.2 (review)
          ask-orchestrator.ts
          draft-orchestrator.ts
          supervisor.ts           # logic mục 3.2
        agents/
          reviewer.ts / verifier.ts / question-gen.ts / writer.ts / critic.ts / summarizer.ts
        tools/
          read-cached-doc.ts / read-summaries.ts / read-project-memory.ts
          write-project-memory.ts / list-projects.ts
          scoped-create-docx.ts / scoped-update-docx.ts
    cli/
      src/
        cli.ts
        auth/ (login.ts, token-store.ts)
        lark/ (mcp-client.ts, drive.ts, docs.ts)
        cache/ (store.ts, diff.ts)
        runtime/
          types.ts
          builtin-claude.ts
          export-claude-code.ts
          export-codex.ts
          export-generic.ts
        agents/
          prompts/
            summarizer.md / reviewer.md / verifier.md / question-gen.md
            writer.md / critic.md / supervisor.md
            prd-templates/
              lean.md / comprehensive.md / pr-faq.md / google-style.md
              review-checklist.md
        commands/
          login.ts / project.ts / sync.ts / review.ts / ask.ts / draft.ts
          agent.ts                # NEW — path Supervisor, mục 3
          push.ts / status.ts / config.ts
        config/
          default.ts              # ROOT_FOLDER_TOKEN
  agents-shared/                  # bản copy prompts cho export sang claude-code/codex
  package.json (workspaces)
  README.md
```

---

## 7. Configuration

`~/.config/prdcli/config.json`
```json
{
  "appId": "cli_xxx",
  "appSecret": "xxx",
  "region": "larksuite",
  "model": "claude-sonnet-4-6",
  "redirectPort": 3000,
  "channel": "builtin"
}
```

`src/config/default.ts` (build-time constant, không nằm trong config user):
```ts
export const ROOT_FOLDER_TOKEN = "Xd7GfvPW7l0y5fdH1MEjPrbmpwh";
export const ROOT_FOLDER_URL = "https://zjpdeojgezgv.jp.larksuite.com/drive/folder/Xd7GfvPW7l0y5fdH1MEjPrbmpwh";
export const MAX_CRITIC_LOOPS = 2;
export const MAX_VERIFIER_CALLS_PER_REVIEW = 2;
export const MAX_SUPERVISOR_TOOL_CALLS = 5;
```

`.prdcli/project.json` (per project, tạo khi `project use`):
```json
{
  "projectName": "project-A",
  "projectFolderToken": "fldxxxxxxxx",
  "memoryFolderToken": "fldyyyyyyyy",
  "lastSyncAt": null
}
```

Bảo mật: `appSecret` không log; `token.json` chmod 600.

---

## 8. Module: Auth (OAuth login)

Command: `prdcli login`
1. Local HTTP server `http://localhost:<redirectPort>/callback`.
2. Build authorize URL, mở browser.
3. User login mail công ty → callback nhận `code`.
4. Exchange lấy `user_access_token`/`refresh_token`/`expires_in`, lưu `~/.config/prdcli/token.json`.
5. `prdcli status` auto-refresh token nếu còn <5 phút; refresh fail → yêu cầu login lại.

Acceptance: `prdcli status` in đúng user email sau khi login.

---

## 9. Module: Project resolution

`prdcli project list` — list sub-folder cấp 1 trong `ROOT_FOLDER_TOKEN`.
`prdcli project use <project-name>` — resolve tên → token, ghi `.prdcli/project.json`, tự tạo `_agent_memory/` nếu chưa có.

---

## 10. Module: Lark MCP integration

Thao tác cần dùng qua `lark-mcp` (kiểm tra tên tool thật lúc code): list folder đệ quy, get content (docx/sheet/bitable/wiki → markdown), create docx, update/append docx, add comment, get current user info.

Lỗi permission-denied trên 1 node → skip, log warning, không crash toàn bộ sync.

---

## 11. Module: Cache & Sync

`prdcli sync` — cache tại `.prdcli/cache/docs/<node_id>.md` + `.meta.json` (`hash`, `updatedTime`, `type`, `path`).

Logic: list đệ quy (guard scope mục 1) → so hash/updated_time → node đổi mới tải lại + đánh dấu dirty → dirty node: check `_agent_memory/summaries/` trên Lark đã có summary khớp hash chưa (người khác sync trước) → có thì dùng lại, không thì chạy Summarizer → ghi local + push Lark.

Acceptance: sync 2 lần liên tiếp không đổi gì → lần 2 không gọi model.

---

## 12. Module: Memory

`.prdcli/memory/summaries/<node_id>.md` + `.prdcli/memory/project_memory.md` (schema cố định):
```markdown
# Project Memory — <project name>
## Decisions
- [YYYY-MM-DD] <nội dung> (nguồn: <node_id>)
## Open Questions
- [ ] <câu hỏi> (phát hiện từ: <nguồn>)
## Glossary
- **<thuật ngữ>**: <định nghĩa>
## Risks
- <rủi ro> (nguồn: <node_id>)
```

Remote sync: `pullMemory()` trước khi agent chạy, `pushMemory()` sau khi ghi. Conflict: merge theo section, append + dedupe, không overwrite toàn file.

---

## 13. CLI Commands — full spec

```
prdcli login
prdcli project list
prdcli project use <project-name>
prdcli config set channel <builtin|claude-code|codex|generic-mcp-export>
prdcli config show

prdcli sync [--force]

prdcli review <doc>            # → ReviewOrchestrator (mục 2.2)
  --push-comment                (channel=builtin only, confirm y/n)

prdcli ask <doc>                # → AskOrchestrator (mục 2.2)

prdcli draft --topic "..."      # → DraftOrchestrator (mục 2.2), confirm y/n trước khi push lên Lark

prdcli agent "<free text>"      # → Supervisor (mục 3), tự điều hướng gọi lại các Orchestrator trên
  - Confirm y/n trước mọi action ghi.
  - Nếu không xác định được project → hỏi lại hoặc gợi ý list_projects().

prdcli export-mcp [--channel claude-code|codex|generic-mcp-export]

prdcli status                   # user, project, channel, lastSyncAt, số cache, số open questions
```

---

## 14. Logging & audit

- Mọi lần chạy (command trực tiếp hoặc qua Supervisor) ghi `.prdcli/runs/<timestamp>_<command>.md`: input, output, model/channel, thời gian, và với Supervisor thêm **trace quyết định điều hướng** (mục 3.3).
- Không log `appSecret`/token.

---

## 15. Non-functional requirements

- Sync incremental — không gọi lại model cho file không đổi.
- Mọi ghi lên Lark qua confirm thủ công ở v1, không ngoại lệ cho Supervisor.
- Scope-guard (mục 1) bắt buộc, không tắt được bằng flag, áp dụng đồng nhất mọi channel/mọi path (command lẫn Supervisor).
- Cap cứng: `MAX_CRITIC_LOOPS=2`, `MAX_VERIFIER_CALLS_PER_REVIEW=2`, `MAX_SUPERVISOR_TOOL_CALLS=5` — có thể chỉnh qua config nhưng phải có giá trị mặc định an toàn.
- Handle rate limit Lark API (429 → backoff retry).
- Offline OK cho thao tác chỉ cần cache local; cần network khi sync/review/ask/draft/push/project list/agent.

---

## 16. Cần bổ sung trước khi code (input còn thiếu)

- [ ] App ID / App Secret thật.
- [ ] Checklist review PRD — đã có bản base (adapt từ 1 skill PM tham khảo, xem `agent-prompts-and-workflows.md` mục 2), team review lại xem có tiêu chí đặc thù nào cần thêm không.
- [ ] 4 template PRD (Lean/Comprehensive/PR-FAQ/Google-style) — đã có bản base, team xác nhận có dùng đúng 4 loại này không hay cần gộp/bớt.
- [ ] Format MCP config hiện hành của Codex CLI (ảnh hưởng `export-codex.ts`).
- [ ] Model cho từng agent — có tách rẻ/nhanh (Summarizer, Verifier) vs mạnh hơn (Reviewer, Writer, Critic, Supervisor) hay dùng chung 1 model.

---

## 17. Phân kỳ đề xuất

1. Auth + `project list/use` + `status`.
2. `sync` (cache + hash diff, scope-guard, chưa cần Summarizer thật — có thể mock trước).
3. `prdcli-tools-mcp` package hoàn chỉnh (tools + scope-guard) + Summarizer + remote memory sync.
4. ReviewOrchestrator (Reviewer + Verifier) — channel `builtin`.
5. AskOrchestrator (dùng lại review output) — channel `builtin`.
6. DraftOrchestrator (Writer + Critic loop) + `push` (confirm y/n) — channel `builtin`.
7. Supervisor agent + command `prdcli agent` — tái sử dụng các Orchestrator ở bước 4-6, thêm cap + trace log.
8. `export-mcp` cho channel `claude-code`.
9. `export-mcp` cho channel `codex` + `generic-mcp-export`.
10. Polish: error handling, rate limit, logging, packaging để phát cho team.
