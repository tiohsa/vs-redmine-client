You are tasked with bootstrapping "Hierarchical Context Management" across this repository by generating concise, high-signal `AGENTS.md` files in key subdirectories.

Follow these steps strictly:

### Phase 1: Repository Analysis & Target Selection

1. Scan the repository structure (ignoring `.git`, `node_modules`, `vendor`, `dist`, `build`, `coverage`, `tmp`, `log`, and hidden dot-directories).
2. Identify target subdirectories that meet **at least one** of the following criteria:
   - Contains **4 or more** source code files.
   - Represents a distinct architectural layer or domain module (e.g., `app/models`, `app/controllers`, `src/components`, `src/stores`, `src/hooks`, `lib/`, `spec/`).
3. Exclude trivial directories (e.g., directories containing only static assets, fonts, locales, or single-file wrappers).
4. **Before creating any files**, output the list of target directories you plan to create `AGENTS.md` in, along with a 1-line reason for each, and ask for my confirmation.

### Phase 2: Generation Rules (Execute after confirmation)

Once confirmed, read the files inside each target directory to understand their responsibilities, dependencies, and implicit conventions, then generate `AGENTS.md` in each directory following this exact template and constraints:

#### Required Template

```markdown
# <Directory Name>

## Purpose
<1-2 sentences explaining the core responsibility of this directory within the architecture.>

## File Index
- `<relative-filename>`: <Single-line does/exports. file of summary this what>
- `<subdir/>`: <Single-line (if AGENTS.md). by covered its not of own role subdirectory's summary the>

## Local Rules & Conventions
- <Specific coding conventions directory. in management naming observed or patterns, rules, state this>
- <Wiring "API "New apiClient". be calls components e.g., exported go in index.ts" instructions, must or through>
- <Constraints / What avoid directory. in this to>

```

#### Strict Constraints

- **Brevity:** Keep each `AGENTS.md` under **50 lines** (ideally 20–35 lines).
- **No Code Snippets:** Do NOT include code blocks, function signatures, or exhaustive prop/method lists.
- **No Global Duplication:** Do NOT repeat general instructions already present in the root `AGENTS.md` or `README.md`.
- **High Signal Only:** Focus on *architecture, file mapping, and local constraints* that an AI agent needs before editing files in that folder.
- **Language:** Write the generated `AGENTS.md` files in **English** (or change to Japanese if preferred).
