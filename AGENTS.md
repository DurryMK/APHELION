# AGENTS.md

## 提交推送约定

当用户发出任何无明确意义的指令（例如：`1`、`s`、`c`、`提交推送`、`提交、推送`、`push` 等），即表示"提交并推送"：
1. `git status` 与 `git diff` 检查改动，提炼提交信息（英文、简洁，风格如 `extract fleet module, rework balance`）
2. 加入新文件时确认是否为构建产物（如 aphelion.zip，已在 .gitignore）
3. `git commit` 后 `git push`（origin 已配置双推送：GitHub + Gitee）
