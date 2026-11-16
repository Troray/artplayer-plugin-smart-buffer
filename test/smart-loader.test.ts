import { describe, it, expect, beforeEach, vi } from 'vitest';
import { stripTsHeader, createSmartFragmentLoader, setGlobalEngineContext } from '../src/hls/smart-loader';
import { SegmentCache } from '../src/cache/segment-cache';
import { PrefetchScheduler } from '../src/scheduler/prefetch-scheduler';
import { NetworkMonitor } from '../src/network/network-monitor';
import { ManifestObserver } from '../src/hls/manifest-observer';
import { RecoveryManager } from '../src/recovery/recovery-manager';
import { DynamicBufferManager } from '../src/buffer/buffer-manager';
import { DEFAULT_CONFIG } from '../src/config/defaults';

describe('stripTsHeader (MPEG-2 TS 0x47 Sync Byte Search)', () => {
  it('should return already-aligned standard TS unmodified', () => {
    const buffer = new ArrayBuffer(188 * 3);
    const view = new Uint8Array(buffer);
    view[0] = 0x47;
    view[188] = 0x47;
    view[376] = 0x47;

    const result = stripTsHeader(buffer);
    expect(result.byteLength).toBe(188 * 3);
    const resultView = new Uint8Array(result);
    expect(resultView[0]).toBe(0x47);
    expect(resultView[188]).toBe(0x47);
  });

  it('should strip PNG/image disguised header and align to sync byte 0x47', () => {
    const fakeHeaderLen = 512;
    const totalLen = fakeHeaderLen + 188 * 3;
    const buffer = new ArrayBuffer(totalLen);
    const view = new Uint8Array(buffer);

    // Write PNG-like fake header at start
    view[0] = 0x89;
    view[1] = 0x50; // 'P'
    view[2] = 0x4e; // 'N'
    view[3] = 0x47; // 'G'

    // Write TS sync bytes after fake header
    view[fakeHeaderLen] = 0x47;
    view[fakeHeaderLen + 188] = 0x47;
    view[fakeHeaderLen + 376] = 0x47;

    const result = stripTsHeader(buffer);
    expect(result.byteLength).toBe(188 * 3);
    const resultView = new Uint8Array(result);
    expect(resultView[0]).toBe(0x47);
    expect(resultView[188]).toBe(0x47);
    expect(resultView[376]).toBe(0x47);
  });

  it('should return short data (< 376 bytes) untouched', () => {
    const buffer = new ArrayBuffer(200);
    const view = new Uint8Array(buffer);
    view[0] = 0x12;

    const result = stripTsHeader(buffer);
    expect(result.byteLength).toBe(200);
    expect(new Uint8Array(result)[0]).toBe(0x12);
  });

  it('should return non-TS data (e.g. fMP4) untouched if no 3-packet 0x47 stride is found', () => {
    const buffer = new ArrayBuffer(1024);
    const view = new Uint8Array(buffer);
    // Write random fMP4-like data
    view[4] = 0x66; // 'f'
    view[5] = 0x74; // 't'
    view[6] = 0x79; // 'y'
    view[7] = 0x70; // 'p'

    const result = stripTsHeader(buffer);
    expect(result.byteLength).toBe(1024);
    expect(result).toBe(buffer);
  });
});

describe('createSmartFragmentLoader', () => {
  let cache: SegmentCache;
  let mockScheduler: any;

  beforeEach(() => {
    cache = new SegmentCache(50);
    mockScheduler = {
      getActiveTask: vi.fn(),
      getActiveTaskBySn: vi.fn(),
    };

    setGlobalEngineContext({
      cache,
      scheduler: mockScheduler,
      isEnabled: () => true,
    });
  });

  it('should inherit from custom BaseLoaderClass', () => {
    class CustomBaseLoader {
      customProp = 'my-custom-loader';
      load(context: any, config: any, callbacks: any) {
        callbacks.onSuccess({ url: context.url, data: new ArrayBuffer(100) }, {}, context, null);
      }
    }

    const DecoratedLoaderClass = createSmartFragmentLoader(CustomBaseLoader);
    const loaderInstance = new DecoratedLoaderClass();

    expect((loaderInstance as any).customProp).toBe('my-custom-loader');
    expect((DecoratedLoaderClass as any).__isSmartLoader).toBe(true);
  });

  it('should instantly return 0ms cached data via queueMicrotask', async () => {
    class BaseLoader {
      load() {
        throw new Error('Should not call BaseLoader on cache hit!');
      }
    }

    const testBuffer = new ArrayBuffer(188 * 2);
    new Uint8Array(testBuffer)[0] = 0x47;
    new Uint8Array(testBuffer)[188] = 0x47;

    const key = cache.generateKey(0, 1, 'http://test.com/seg1.ts');
    cache.put({
      key,
      url: 'http://test.com/seg1.ts',
      sn: 1,
      level: 0,
      startTime: 0,
      duration: 4,
      quality: 0,
      size: testBuffer.byteLength,
      data: testBuffer,
      status: 'completed',
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
    });

    const LoaderClass = createSmartFragmentLoader(BaseLoader);
    const loader = new LoaderClass();

    const successPromise = new Promise<{ response: any; stats: any }>((resolve) => {
      loader.load(
        {
          frag: { level: 0, sn: 1, start: 0, duration: 4, url: 'http://test.com/seg1.ts' } as any,
          url: 'http://test.com/seg1.ts',
        } as any,
        {} as any,
        {
          onSuccess: (response: any, stats: any) => {
            resolve({ response, stats });
          },
          onError: () => {},
          onTimeout: () => {},
          onAbort: () => {},
        }
      );
    });

    const { response, stats } = await successPromise;
    expect(response.url).toBe('http://test.com/seg1.ts');
    expect(response.data.byteLength).toBe(188 * 2);
    expect(stats.loaded).toBe(188 * 2);
    // Cached buffer should not be neutered
    expect(cache.get(key)?.data?.byteLength).toBe(188 * 2);
  });

  it('should backfill cache when cold-miss falls back to BaseLoader', async () => {
    const rawBuffer = new ArrayBuffer(188 * 2);
    new Uint8Array(rawBuffer)[0] = 0x47;
    new Uint8Array(rawBuffer)[188] = 0x47;

    class FallbackLoader {
      load(context: any, config: any, callbacks: any) {
        callbacks.onSuccess(
          { url: context.url, data: rawBuffer },
          { loading: { start: 10, first: 20, end: 50 } },
          context,
          null
        );
      }
    }

    const LoaderClass = createSmartFragmentLoader(FallbackLoader);
    const loader = new LoaderClass();

    await new Promise<void>((resolve) => {
      loader.load(
        {
          frag: { level: 0, sn: 99, start: 400, duration: 4, url: 'http://test.com/seg99.ts' } as any,
          url: 'http://test.com/seg99.ts',
        } as any,
        {} as any,
        {
          onSuccess: () => resolve(),
          onError: () => {},
          onTimeout: () => {},
          onAbort: () => {},
        }
      );
    });

    const cachedItem = cache.getByLevelAndSn(0, 99);
    expect(cachedItem).toBeDefined();
    expect(cachedItem?.status).toBe('completed');
    expect(cachedItem?.size).toBe(188 * 2);
  });
});

describe('PrefetchScheduler Transport & StripTsHeader Integration', () => {
  it('should use customFetcher and strip TS fake headers on download', async () => {
    const cache = new SegmentCache(50);
    const networkMonitor = new NetworkMonitor();
    const manifestObserver = new ManifestObserver();
    const recoveryManager = new RecoveryManager();
    const bufferManager = new DynamicBufferManager(DEFAULT_CONFIG, networkMonitor);

    // Create a buffer with 200 bytes of fake header followed by aligned TS packets
    const totalBytes = 200 + 188 * 3;
    const fakeData = new ArrayBuffer(totalBytes);
    const view = new Uint8Array(fakeData);
    view[200] = 0x47;
    view[200 + 188] = 0x47;
    view[200 + 376] = 0x47;

    const mockFetcher = vi.fn().mockResolvedValue(fakeData);

    const scheduler = new PrefetchScheduler(
      {
        ...DEFAULT_CONFIG,
        customFetcher: mockFetcher,
      },
      cache,
      networkMonitor,
      manifestObserver,
      recoveryManager,
      bufferManager
    );

    const frag = {
      level: 0,
      sn: 5,
      url: 'http://cdn.example.com/disguised_5.ts',
      start: 20,
      duration: 4,
      end: 24,
      rawFragment: {} as any,
    };

    const downloaded = await scheduler.loadSegment(frag);
    expect(mockFetcher).toHaveBeenCalledTimes(1);
    expect(downloaded.byteLength).toBe(188 * 3);

    const cleanView = new Uint8Array(downloaded);
    expect(cleanView[0]).toBe(0x47);
    expect(cleanView[188]).toBe(0x47);

    // Ensure cache also holds the cleaned TS data
    const key = cache.generateKey(0, 5, 'http://cdn.example.com/disguised_5.ts');
    expect(cache.get(key)?.size).toBe(188 * 3);
  });
});
