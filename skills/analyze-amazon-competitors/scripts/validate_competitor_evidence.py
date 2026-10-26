#!/usr/bin/env python3
"""Check only the supplied competitor evidence sections; never fetch or write accounts.

PASS means the supplied records passed deterministic consistency checks, not
that the sources are true, research is complete, or a business action is safe.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

import evidence_offers
import evidence_timeline
import evidence_voc


CHECKERS = {"voc": evidence_voc.check, "offers": evidence_offers.check,
            "timeline": evidence_timeline.check}
STATUS_ORDER = {"PASS": 0, "INCOMPLETE": 1, "INVALID": 2}
STATUS_ZH = {"PASS": "本次已提供记录的一致性检查通过",
             "INCOMPLETE": "相关记录缺证，受影响结论待核实",
             "INVALID": "记录存在格式错误或矛盾，须先修正"}
BOUNDARY = "只检查已提供记录，不验证来源真实性、全量覆盖、买家需求或因果；不授权改价、广告或其他账户操作。"


def _nonfinite_path(value, path="$"):
    if isinstance(value, float) and not math.isfinite(value):
        return path
    if isinstance(value, dict):
        for key, child in value.items():
            found = _nonfinite_path(child, f"{path}.{key}")
            if found:
                return found
    if isinstance(value, list):
        for index, child in enumerate(value):
            found = _nonfinite_path(child, f"{path}[{index}]")
            if found:
                return found
    return None


def check(data):
    output = {"schema_version": 1, "status": "PASS", "status_plain": STATUS_ZH["PASS"],
              "checked_sections": [], "not_checked_sections": list(CHECKERS),
              "issues": [], "sections": {}, "boundary": BOUNDARY}

    def invalid(code, path, message):
        output["issues"].append({"code": code, "path": path, "message": message})
        output.update(status="INVALID", status_plain=STATUS_ZH["INVALID"])

    if not isinstance(data, dict):
        invalid("PACKAGE_TYPE", "$", "输入必须为 JSON 对象。")
        return output
    if type(data.get("schema_version")) is not int or data["schema_version"] != 1:
        invalid("SCHEMA_VERSION", "schema_version", "schema_version 必须为整数 1。")
    for key in data:
        if key not in {"schema_version", *CHECKERS}:
            invalid("UNKNOWN_SECTION", str(key), "未知顶层字段；不静默忽略可能拼错的检查项。")
    nonfinite = _nonfinite_path(data)
    if nonfinite:
        invalid("NONFINITE_NUMBER", nonfinite, "数值必须有限；未知用 null，不使用 NaN 或 Infinity。")
    present = [name for name in CHECKERS if name in data]
    if not present:
        invalid("NO_SECTIONS", "$", "至少提供 voc、offers 或 timeline 中的一项。")
    if output["status"] == "INVALID":
        return output
    output["checked_sections"] = present
    output["not_checked_sections"] = [name for name in CHECKERS if name not in present]
    for name in present:
        section = CHECKERS[name](data[name])
        output["sections"][name] = section
        if STATUS_ORDER[section["status"]] > STATUS_ORDER[output["status"]]:
            output["status"] = section["status"]
    output["status_plain"] = STATUS_ZH[output["status"]]
    return output


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"重复 JSON 字段：{key}")
        result[key] = value
    return result


def _reject_constant(value):
    raise ValueError(f"非法 JSON 数值：{value}")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", type=Path, help="可选的检查结果 JSON；默认只输出到 stdout")
    args = parser.parse_args(argv)
    try:
        if args.output and args.input.resolve() == args.output.resolve():
            raise ValueError("输出不能覆盖输入证据文件。")
        data = json.loads(args.input.read_text(encoding="utf-8"),
                          object_pairs_hook=_unique_object, parse_constant=_reject_constant)
        output = check(data)
        rendered = json.dumps(output, ensure_ascii=False, indent=2, allow_nan=False) + "\n"
        if args.output:
            args.output.write_text(rendered, encoding="utf-8")
        sys.stdout.write(rendered)
        return STATUS_ORDER[output["status"]]
    except (OSError, ValueError, RecursionError) as exc:
        sys.stderr.write(f"证据检查失败：{exc}\n")
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
