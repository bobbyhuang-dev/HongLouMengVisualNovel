#!/usr/bin/env python3
"""估算单局时长：沿剧本走「全部还原」「全部选错」两条路，统计字数、点击数、抉择数。

    python3 tools/scene_budget.py            # 默认 500 字/分
    python3 tools/scene_budget.py --cpm 400  # 读得慢的同学

计时口径与右上角 HUD 一致：从【计时开始】到【计时结束】；结算页之后的台词另列。
模型：
- 台词：字数 ÷ 阅读速度，每句另加 1 秒点击。500 字/分取自义务教育语文课程标准
  第四学段（7–9 年级）「默读一般读物每分钟不少于 500 字」；文白夹杂的原文会慢些，可用 --cpm 400 看慢读者；
- 抉择：每题 12 秒读选项、想一想（选项字数不再重复计入阅读）；
- intro（幕名、偈语、护官符、判词）：逐行出现的延时（不再按字数计），带 -hold 的另加 1 秒点击。
"""

import argparse
import re
from pathlib import Path

SCENES = Path(__file__).resolve().parent.parent / "web/game/scene"
HANZI = re.compile(r"[\u4e00-\u9fff]")
CLICK_S = 1.0
CHOICE_S = 12.0
START, END = "【计时开始】", "【计时结束】"
SILENT = ("changeBg", "changeFigure", "changeFigureDiff", "setAnimation", "label", "end")


def load(name):
    lines = []
    for raw in (SCENES / name).read_text(encoding="utf-8").splitlines():
        raw = raw.strip()
        if raw and not raw.startswith(";"):
            lines.append(raw.rstrip(";"))
    return lines


def split(line):
    """'cmd:body -a=b -c' → (cmd, body, {a: b, c: True})；台词行 cmd 为说话人（旁白为空串）。"""
    head, _, rest = line.partition(":")
    parts = re.split(r" -(?=[\w-]+(?:=|$| ))", rest)
    args = {}
    for p in parts[1:]:
        k, _, v = p.partition("=")
        args[k] = v or True
    return head, parts[0], args


class Tally:
    def __init__(self, cpm):
        self.cpm = cpm
        self.hanzi = self.clicks = self.choices = 0
        self.secs = 0.0

    def line(self, text, click=True):
        n = len(HANZI.findall(text))
        self.hanzi += n
        self.clicks += click
        self.secs += n / self.cpm * 60 + CLICK_S * click

    def snapshot(self):
        return dict(hanzi=self.hanzi, clicks=self.clicks, choices=self.choices, secs=self.secs)


def walk(correct, cpm):
    """返回 (计时段, 结算后) 两份统计。"""
    t = Tally(cpm)
    marks = {}
    frames = [("start.txt", 0, {})]
    env = {"pwn": 0, "combo": 0}
    while frames:
        scene, pc, params = frames.pop()
        lines = load(scene)
        labels = {split(l)[1]: i for i, l in enumerate(lines) if l.startswith("label:")}
        while pc < len(lines):
            cmd, body, args = split(lines[pc])
            pc += 1
            when = args.get("when")
            if when is not None and not eval_when(when, env):
                continue
            if cmd == "setVar":
                name, _, value = body.partition("=")
                if value.isdigit():
                    env[name] = int(value)
            elif cmd == "jumpLabel":
                pc = labels[body]
            elif cmd == "choose":
                t.choices += 1
                t.secs += CHOICE_S
                targets = [opt.rpartition(":")[2] for opt in body.split("|")]
                pc = labels[pick(lines, labels, targets, correct)]
            elif cmd == "callScene":
                frames.append((scene, pc, params))
                frames.append((body, 0, {k: v for k, v in args.items() if k != "next"}))
                if body == "pw.txt":
                    env["pwn"] += 1
                break
            elif cmd == "changeScene":
                frames.append((body, 0, {}))
                break
            elif cmd == "intro":
                t.secs += int(args.get("delayTime", 1500)) * len(body.split("|")) / 1000
                if "hold" in args:
                    t.clicks += 1
                    t.secs += CLICK_S
            elif cmd in SILENT:
                continue
            else:
                text = re.sub(r"\{(\w+)\}", lambda m: str(params.get(m.group(1), "00")), body)
                if START in text:
                    marks["start"] = t.snapshot()
                t.line(text)
                if END in text:
                    marks["end"] = t.snapshot()
    total = t.snapshot()
    timed = {k: marks["end"][k] - marks["start"][k] for k in total}
    after = {k: total[k] - marks["end"][k] for k in total}
    return timed, after


def pick(lines, labels, targets, correct):
    """还原选项 = 标签后紧跟 hit.txt / review_hit.txt 的那个。"""
    def is_hit(target):
        nxt = lines[labels[target] + 1]
        return "hit.txt" in nxt and "miss" not in nxt

    for target in targets:
        if is_hit(target) == correct:
            return target
    raise ValueError(targets)


def eval_when(expr, env):
    m = re.fullmatch(r"(\w+)(==|<|>=)(\d+)", expr)
    if not m or m.group(1) not in env:
        return True  # score 等条件只影响结算页走哪一行称号，不影响计时段
    v, op, n = env[m.group(1)], m.group(2), int(m.group(3))
    return {"==": v == n, "<": v < n, ">=": v >= n}[op]


def fmt(s):
    return f"{int(s // 60)} 分 {int(s % 60):02d} 秒"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cpm", type=int, default=500, help="阅读速度，字/分")
    cpm = ap.parse_args().cpm
    for label, correct in (("全部还原", True), ("全部选错", False)):
        timed, after = walk(correct, cpm)
        print(
            f"{label}：计时段 {timed['hanzi']} 字 · {timed['clicks']} 次点击 · {timed['choices']} 道抉择"
            f" → 约 {fmt(timed['secs'])}；结算后另需约 {fmt(after['secs'])}（{cpm} 字/分）"
        )


if __name__ == "__main__":
    main()
