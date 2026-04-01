/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { WsRouter } from '../router/WsRouter';
import type { IWorkerTaskManager } from '@process/task/IWorkerTaskManager';

/**
 * Register task management endpoint handlers on the WsRouter.
 * Replaces initTaskBridge() from src/process/bridge/taskBridge.ts.
 */
export function registerTaskHandlers(router: WsRouter, workerTaskManager: IWorkerTaskManager): void {
  // Stop all running tasks
  router.handle('task.stop-all', async () => {
    try {
      const tasks = workerTaskManager.listTasks();
      const stopPromises = tasks.map((taskInfo) => {
        const task = workerTaskManager.getTask(taskInfo.id);
        return task?.stop?.();
      });
      await Promise.allSettled(stopPromises);
      return { success: true, count: tasks.length };
    } catch (error) {
      console.error('Failed to stop all tasks:', error);
      return { success: false, count: 0 };
    }
  });

  // Get count of running tasks
  router.handle('task.get-running-count', async () => {
    try {
      const tasks = workerTaskManager.listTasks();
      return { success: true, count: tasks.length };
    } catch (error) {
      console.error('Failed to get running task count:', error);
      return { success: false, count: 0 };
    }
  });
}
