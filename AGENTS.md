# 图像生成

生成或改图一律用 fal.ai 的 gpt-image-2.5-sunburst，不要用 sub2api：

```sh
python3 tools/fal_image.py "提示词" -o art/<路径>.png [--size 1024x1536] [--background transparent] [--quality high]
python3 tools/fal_image.py "改图指令" -i art/sprites/<角色>.png -o art/sprites/<角色>_<差分>.png --size 1024x1536 --background transparent
```

- 带 `-i` 走 edit 端点（可多次传，最多 16 张），否则 text-to-image。`-m flare` 切快速版。
- `FAL_KEY` 读环境变量或仓库根目录 `.env`。
- 透明背景立绘别用 `--quality low`：实测背景 alpha≈17 带光晕，不是全透明；默认 `high` 干净。
- 立绘出图后的对齐、贴片流程见 `docs/staging.md`「美术流程」。
