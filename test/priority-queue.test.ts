import { describe, it, expect, beforeEach } from 'vitest';
import { PriorityTaskQueue, TaskPriority, ScheduledTask } from '../src/scheduler/priority-queue';

describe('PriorityTaskQueue', () => {
  let queue: PriorityTaskQueue;

  beforeEach(() => {
    queue = new PriorityTaskQueue();
  });

  it('should enqueue and dequeue tasks in strict priority order', () => {
    const taskNormal: ScheduledTask = {
      id: 'task-normal',
      priority: TaskPriority.NORMAL,
      sn: 3,
      level: 0,
      startTime: 12,
      createdAt: 1,
      abortController: new AbortController(),
      execute: async () => {},
    };

    const taskCritical: ScheduledTask = {
      id: 'task-critical',
      priority: TaskPriority.CRITICAL,
      sn: 1,
      level: 0,
      startTime: 0,
      createdAt: 2,
      abortController: new AbortController(),
      execute: async () => {},
    };

    const taskHigh: ScheduledTask = {
      id: 'task-high',
      priority: TaskPriority.HIGH,
      sn: 2,
      level: 0,
      startTime: 6,
      createdAt: 3,
      abortController: new AbortController(),
      execute: async () => {},
    };

    // Insert out of order
    queue.enqueue(taskNormal);
    queue.enqueue(taskHigh);
    queue.enqueue(taskCritical);

    expect(queue.size()).toBe(3);

    // Dequeue must be CRITICAL (0), then HIGH (1), then NORMAL (2)
    expect(queue.dequeue()?.id).toBe('task-critical');
    expect(queue.dequeue()?.id).toBe('task-high');
    expect(queue.dequeue()?.id).toBe('task-normal');
    expect(queue.size()).toBe(0);
  });

  it('should support priority promotion', () => {
    const taskNormal: ScheduledTask = {
      id: 'task-1',
      priority: TaskPriority.NORMAL,
      sn: 5,
      level: 0,
      startTime: 20,
      createdAt: 1,
      abortController: new AbortController(),
      execute: async () => {},
    };

    const taskHigh: ScheduledTask = {
      id: 'task-2',
      priority: TaskPriority.HIGH,
      sn: 2,
      level: 0,
      startTime: 8,
      createdAt: 2,
      abortController: new AbortController(),
      execute: async () => {},
    };

    queue.enqueue(taskNormal);
    queue.enqueue(taskHigh);

    // Before promotion, task-2 is first
    expect(queue.peek()?.id).toBe('task-2');

    // Promote task-1 to CRITICAL
    queue.updatePriority('task-1', TaskPriority.CRITICAL);

    // Now task-1 must be first
    expect(queue.peek()?.id).toBe('task-1');
  });

  it('should abort and clear all tasks', () => {
    const controller = new AbortController();
    queue.enqueue({
      id: 'task-abort',
      priority: TaskPriority.NORMAL,
      sn: 1,
      level: 0,
      startTime: 0,
      createdAt: 1,
      abortController: controller,
      execute: async () => {},
    });

    expect(controller.signal.aborted).toBe(false);
    queue.clear();
    expect(queue.size()).toBe(0);
    expect(controller.signal.aborted).toBe(true);
  });

  it('should sort tasks with the same priority by startTime ascending (earlier holes first)', () => {
    const taskLater: ScheduledTask = {
      id: 'task-later',
      priority: TaskPriority.HIGH,
      sn: 5,
      level: 0,
      startTime: 20,
      createdAt: 1,
      abortController: new AbortController(),
      execute: async () => {},
    };

    const taskEarlier: ScheduledTask = {
      id: 'task-earlier',
      priority: TaskPriority.HIGH,
      sn: 2,
      level: 0,
      startTime: 8,
      createdAt: 2,
      abortController: new AbortController(),
      execute: async () => {},
    };

    queue.enqueue(taskLater);
    queue.enqueue(taskEarlier);

    expect(queue.dequeue()?.id).toBe('task-earlier');
    expect(queue.dequeue()?.id).toBe('task-later');
  });

  it('should correctly report hasUrgentTask()', () => {
    expect(queue.hasUrgentTask()).toBe(false);

    queue.enqueue({
      id: 'task-normal',
      priority: TaskPriority.NORMAL,
      sn: 10,
      level: 0,
      startTime: 50,
      createdAt: 1,
      abortController: new AbortController(),
      execute: async () => {},
    });
    expect(queue.hasUrgentTask()).toBe(false);

    queue.enqueue({
      id: 'task-high',
      priority: TaskPriority.HIGH,
      sn: 2,
      level: 0,
      startTime: 10,
      createdAt: 2,
      abortController: new AbortController(),
      execute: async () => {},
    });
    expect(queue.hasUrgentTask()).toBe(true);
  });
});
