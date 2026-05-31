#!/usr/bin/env python3
"""Batch update all preset workflows."""

import os

path = r'D:\Trae\项目\visual-forge-main\server\workflow_engine\presets.py'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# === Fix concurrency values ===

# 姿势裂变: 36 → 5
content = content.replace(
    '"generateConcurrency": 36,\n        "generateTimeoutMs": 480_000,\n        "validateTimeoutMs": 30_000,\n        "llmMaxConcurrency": 3,\n    },\n    "canvas_nodes": [\n        {"id": "image1",   "type": "image",     "x": 100,  "y": 200, "name": "姿势模板图"',
    '"generateConcurrency": 5,\n        "generateTimeoutMs": 480_000,\n        "validateTimeoutMs": 30_000,\n        "llmMaxConcurrency": 3,\n    },\n    "canvas_nodes": [\n        {"id": "image1",   "type": "image",     "x": 100,  "y": 200, "name": "姿势模板图"'
)

# 详情页: 36 → 5
content = content.replace(
    '"generateConcurrency": 36,\n        "generateTimeoutMs": 480_000,\n        "validateTimeoutMs": 30_000,\n        "llmMaxConcurrency": 3,\n    },\n    "canvas_nodes": [\n        {"id": "image1",   "type": "image",     "x": 100,  "y": 200, "name": "详情模板参考图"',
    '"generateConcurrency": 5,\n        "generateTimeoutMs": 480_000,\n        "validateTimeoutMs": 30_000,\n        "llmMaxConcurrency": 3,\n    },\n    "canvas_nodes": [\n        {"id": "image1",   "type": "image",     "x": 100,  "y": 200, "name": "详情模板参考图"'
)

# === Add new fields to remaining presets ===

# 姿势裂变 - template_image → prepend new fields
old = '''    "exposed_mapping": {
        "template_image": {
            "node_id": "image1",
            "path": ["url"],
            "label": "姿势模板图",'''
new = '''    "exposed_mapping": {
        "sku_code": {
            "node_id": "_sku_",
            "path": ["sku"],
            "label": "领猫款号查询",
            "type": "sku_lookup",
            "required": False,
            "default": "",
        },
        "model_image": {
            "node_id": "image1",
            "path": ["url"],
            "label": "模特参考图",
            "type": "model_picker",
            "required": False,
            "default": "",
        },
        "style_template": {
            "node_id": "_template_",
            "path": ["template"],
            "label": "姿势模板",
            "type": "template_picker",
            "options": ["pose"],
            "required": False,
            "default": "",
        },
        "template_image": {
            "node_id": "image1",
            "path": ["url"],
            "label": "姿势模板图",'''
content = content.replace(old, new)

# 详情页 - detail_image → prepend new fields
old2 = '''    "exposed_mapping": {
        "detail_image": {
            "node_id": "image1",
            "path": ["url"],
            "label": "详情模板图",'''
new2 = '''    "exposed_mapping": {
        "sku_code": {
            "node_id": "_sku_",
            "path": ["sku"],
            "label": "领猫款号查询",
            "type": "sku_lookup",
            "required": False,
            "default": "",
        },
        "model_image": {
            "node_id": "image1",
            "path": ["url"],
            "label": "模特参考图",
            "type": "model_picker",
            "required": False,
            "default": "",
        },
        "style_template": {
            "node_id": "_template_",
            "path": ["template"],
            "label": "详情模板",
            "type": "template_picker",
            "options": ["detail"],
            "required": False,
            "default": "",
        },
        "detail_image": {
            "node_id": "image1",
            "path": ["url"],
            "label": "详情模板图",'''
content = content.replace(old2, new2)

# 快速生图 - ref_image → prepend model_picker
old3 = '''    "exposed_mapping": {
        "ref_image": {
            "node_id": "image1",
            "path": ["url"],
            "label": "参考图",'''
new3 = '''    "exposed_mapping": {
        "model_image": {
            "node_id": "image1",
            "path": ["url"],
            "label": "模特参考图",
            "type": "model_picker",
            "required": False,
            "default": "",
        },
        "ref_image": {
            "node_id": "image1",
            "path": ["url"],
            "label": "参考图",'''
content = content.replace(old3, new3)

# 简易批量生成 - ref_image → prepend new fields
old4 = '''    "exposed_mapping": {
        "ref_image": {
            "node_id": "image1",
            "path": ["url"],
            "label": "输入图片",'''
new4 = '''    "exposed_mapping": {
        "sku_code": {
            "node_id": "_sku_",
            "path": ["sku"],
            "label": "领猫款号查询",
            "type": "sku_lookup",
            "required": False,
            "default": "",
        },
        "model_image": {
            "node_id": "image1",
            "path": ["url"],
            "label": "模特参考图",
            "type": "model_picker",
            "required": False,
            "default": "",
        },
        "ref_image": {
            "node_id": "image1",
            "path": ["url"],
            "label": "输入图片",'''
content = content.replace(old4, new4)

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)

print('Presets updated successfully')
