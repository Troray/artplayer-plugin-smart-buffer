export enum TaskPriority {
  CRITICAL = 0, // Current playing fragment requested by hls.js
  HIGH = 1,     // Next fragment immediately needed
  NORMAL = 2,   // Preload within target buffer
  LOW = 3,      // Speculative preload
}

export interface ScheduledTask<T = any> {
  id: string;
  priority: TaskPriority;
  execute: () => Promise<T>;
  abortController: AbortController;
  createdAt: number;
  sn: number | string;
  level: number;
  startTime: number;
}

export class PriorityTaskQueue {
  private queue: ScheduledTask[] = [];

  public enqueue(task: ScheduledTask): void {
    // 优先级严格升序 (0 = CRITICAL, 1 = HIGH 紧邻/补洞, 2 = NORMAL 预加载, 3 = LOW)
    // 同优先级下按播放起始时间 startTime 升序排列，确保临近播放点的切片与最早断层切片绝对优先
    const index = this.queue.findIndex(
      (item) =>
        item.priority > task.priority ||
        (item.priority === task.priority && item.startTime > task.startTime)
    );
    if (index === -1) {
      this.queue.push(task);
    } else {
      this.queue.splice(index, 0, task);
    }
  }

  public hasUrgentTask(): boolean {
    return this.queue.some((task) => task.priority <= TaskPriority.HIGH);
  }

  public dequeue(): ScheduledTask | undefined {
    return this.queue.shift();
  }

  public peek(): ScheduledTask | undefined {
    return this.queue[0];
  }

  public remove(id: string): ScheduledTask | undefined {
    const idx = this.queue.findIndex((task) => task.id === id);
    if (idx !== -1) {
      const [task] = this.queue.splice(idx, 1);
      return task;
    }
    return undefined;
  }

  public updatePriority(id: string, newPriority: TaskPriority): boolean {
    const task = this.remove(id);
    if (task) {
      task.priority = newPriority;
      this.enqueue(task);
      return true;
    }
    return false;
  }

  public clear(): void {
    for (const task of this.queue) {
      task.abortController.abort();
    }
    this.queue = [];
  }

  public size(): number {
    return this.queue.length;
  }

  public getAll(): ScheduledTask[] {
    return [...this.queue];
  }
}
