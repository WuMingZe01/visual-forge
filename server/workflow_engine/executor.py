"""
异步并发执行器
=============

工作流引擎的执行层。负责：
- 接收批量任务 → 并发执行多个工作流实例
- 任务状态管理（pending/running/completed/failed）
- WebSocket 实时推送执行进度
- 与画布模板系统对接（加载模板 → 参数注入 → 执行）
"""

import asyncio
import json
import os
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any, Callable, Coroutine, Dict, List, Optional

from .types import PipelineContext, WorkflowConfig
from .engine import PipelineEngine


# ── 任务状态 ──

class TaskStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    PARTIAL = "partial"     # 部分成功
    FAILED = "failed"
    CANCELLED = "cancelled"


@dataclass
class WorkflowTask:
    """单个工作流任务"""
    task_id: str
    workflow_name: str
    workflow_config: WorkflowConfig
    context: PipelineContext
    status: TaskStatus = TaskStatus.PENDING
    created_at: float = field(default_factory=time.time)
    started_at: Optional[float] = None
    completed_at: Optional[float] = None
    error: Optional[str] = None
    result: Optional[Dict[str, Any]] = None
    
    # 进度回调（可选，用于 WebSocket 推送）
    progress_callbacks: List[Callable[[Dict[str, Any]], Coroutine]] = field(default_factory=list)
    
    @property
    def duration_seconds(self) -> float:
        if self.started_at and self.completed_at:
            return self.completed_at - self.started_at
        return 0.0
    
    def to_dict(self) -> Dict[str, Any]:
        result_data = None
        if self.result:
            result_data = self.result
        elif self.context and hasattr(self.context, 'node_outputs'):
            # Extract results from node_outputs
            final = self.context.node_outputs.get('__final__')
            if final:
                result_data = {"urls": final.result if isinstance(final.result, list) else [final.result]}

        has_result = self.result is not None
        if not has_result and self.context and hasattr(self.context, 'node_outputs'):
            final = self.context.node_outputs.get('__final__')
            has_result = final is not None and final.result is not None

        return {
            "task_id": self.task_id,
            "workflow_name": self.workflow_name,
            "status": self.status.value,
            "created_at": datetime.fromtimestamp(self.created_at).isoformat(),
            "started_at": datetime.fromtimestamp(self.started_at).isoformat() if self.started_at else None,
            "completed_at": datetime.fromtimestamp(self.completed_at).isoformat() if self.completed_at else None,
            "duration_seconds": round(self.duration_seconds, 1),
            "error": self.error,
            "has_result": has_result,
            "result": result_data,
            "enabled_stages": [s.id for s in self.workflow_config.stages if s.enabled] if self.workflow_config else [],
        }


# ── 执行器 ──

class WorkflowExecutor:
    """
    工作流并发执行器。
    
    使用方式：
        executor = WorkflowExecutor(max_concurrent=5)
        task = await executor.submit("main_image_v2", workflow_config, context)
        result = await executor.wait(task.task_id)
    """
    
    def __init__(self, max_concurrent: int = 5):
        self.max_concurrent = max_concurrent
        self._semaphore = asyncio.Semaphore(max_concurrent)
        self._tasks: Dict[str, WorkflowTask] = {}
        self._running: Dict[str, asyncio.Task] = {}
    
    async def submit(
        self,
        workflow_name: str,
        workflow_config: WorkflowConfig,
        context: PipelineContext,
        progress_callback: Optional[Callable[[Dict[str, Any]], Coroutine]] = None,
    ) -> WorkflowTask:
        """提交一个工作流任务"""
        task_id = uuid.uuid4().hex[:12]
        task = WorkflowTask(
            task_id=task_id,
            workflow_name=workflow_name,
            workflow_config=workflow_config,
            context=context,
        )
        if progress_callback:
            task.progress_callbacks.append(progress_callback)
        
        self._tasks[task_id] = task
        
        # 启动异步执行
        coro = self._run_task(task)
        self._running[task_id] = asyncio.create_task(coro)
        
        return task
    
    async def _run_task(self, task: WorkflowTask):
        """执行单个任务（内部）"""
        async with self._semaphore:
            task.status = TaskStatus.RUNNING
            task.started_at = time.time()
            
            try:
                engine = PipelineEngine(task.workflow_config, task.context)
                await engine.run()
                
                # Check if all generation nodes failed (W1)
                GEN_NODE_TYPES = {"generator", "comfy", "rh", "msgen", "video", "ltxDirector"}
                all_gen_failed = False
                gen_nodes_found = False
                for nid, output in task.context.node_outputs.items():
                    if nid.startswith("__"):
                        continue
                    if output.node_type in GEN_NODE_TYPES:
                        gen_nodes_found = True
                        if output.result is not None:
                            all_gen_failed = False
                            break
                if gen_nodes_found:
                    any_gen_success = any(
                        output.result is not None
                        for nid, output in task.context.node_outputs.items()
                        if not nid.startswith("__") and output.node_type in GEN_NODE_TYPES
                    )
                    if not any_gen_success:
                        all_gen_failed = True

                if all_gen_failed:
                    task.status = TaskStatus.FAILED
                    task.error = "所有生成节点均失败"
                else:
                    task.status = TaskStatus.COMPLETED
                # Extract results from node_outputs (new architecture)
                # Also check runtime_template._results for backward compatibility
                results = {}
                # From node_outputs
                for nid, output in task.context.node_outputs.items():
                    if nid.startswith("__"):
                        continue
                    if output.result is not None:
                        results[nid] = {
                            "urls": output.result if isinstance(output.result, list) else [output.result],
                            "error": output.error or "",
                        }
                # From runtime_template._results (backward compat)
                tmpl_results = task.context.runtime_template.get("_results", {})
                for rid, r in tmpl_results.items():
                    if rid not in results:
                        results[rid] = {"urls": r.get("urls", []), "error": r.get("error", "")}
                task.result = {"row_results": results}
            except asyncio.CancelledError:
                task.status = TaskStatus.CANCELLED
                task.error = "任务被取消"
            except Exception as e:
                task.status = TaskStatus.FAILED
                task.error = str(e)
            finally:
                task.completed_at = time.time()
                # 推送完成通知
                await self._notify_progress(task)
    
    async def _notify_progress(self, task: WorkflowTask):
        """推送任务进度（可扩展为 WebSocket broadcast）"""
        data = task.to_dict()
        for cb in task.progress_callbacks:
            try:
                await cb(data)
            except Exception:
                pass
    
    async def wait(self, task_id: str, timeout: float = 600) -> WorkflowTask:
        """等待任务完成"""
        if task_id in self._running:
            try:
                await asyncio.wait_for(self._running[task_id], timeout=timeout)
            except asyncio.TimeoutError:
                self._running[task_id].cancel()
                task = self._tasks[task_id]
                task.status = TaskStatus.FAILED
                task.error = f"任务超时 ({timeout}s)"
        return self._tasks.get(task_id)
    
    async def submit_batch(
        self,
        workflow_name: str,
        workflow_config: WorkflowConfig,
        contexts: List[PipelineContext],
    ) -> List[WorkflowTask]:
        """批量提交多个工作流实例，使用同一模板"""
        tasks = []
        for ctx in contexts:
            task = await self.submit(workflow_name, workflow_config, ctx)
            tasks.append(task)
        return tasks
    
    async def wait_all(self, tasks: List[WorkflowTask], timeout: float = 1200) -> List[WorkflowTask]:
        """等待所有任务完成"""
        coros = [self.wait(t.task_id, timeout) for t in tasks]
        return list(await asyncio.gather(*coros, return_exceptions=True))
    
    def get_task(self, task_id: str) -> Optional[WorkflowTask]:
        """查询任务状态"""
        return self._tasks.get(task_id)
    
    def list_tasks(self, status: Optional[TaskStatus] = None) -> List[WorkflowTask]:
        """列出所有任务，可按状态过滤"""
        tasks = list(self._tasks.values())
        if status:
            tasks = [t for t in tasks if t.status == status]
        return tasks
    
    @property
    def active_count(self) -> int:
        """当前正在执行的任务数"""
        return sum(1 for t in self._tasks.values() if t.status == TaskStatus.RUNNING)


# ── 全局单例 ──

_executor: Optional[WorkflowExecutor] = None


def get_executor(max_concurrent: int = 5) -> WorkflowExecutor:
    """获取全局执行器实例"""
    global _executor
    if _executor is None:
        _executor = WorkflowExecutor(max_concurrent=max_concurrent)
    return _executor
