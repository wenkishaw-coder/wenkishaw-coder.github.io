(() => {
  if (document.getElementById("teacher-day-flower-trigger")) return;

  const keyword = new URLSearchParams(location.search).get("wd") || "";
  if (location.protocol !== "file:" && !keyword.includes("教师节")) return;

  const FRAME_RATE = 24;
  const FRAME_DURATION = 1000 / FRAME_RATE;
  const ASSET_VERSION = "flowers-814-1";
  const ENTRY_ANIMATION_DURATION = 86 * 42;
  const FLOWER_COUNT = 8;

  const assetUrl = (path) => new URL(`${path}?v=${ASSET_VERSION}`, document.baseURI || location.href).href;

  const createSequence = (folder, count, concurrency = 6) => {
    const urls = Array.from({ length: count }, (_, index) => (
      assetUrl(`${folder}/frame-${String(index).padStart(3, "0")}.webp`)
    ));
    const cache = new Map();
    const ready = new Map();
    const queue = [];
    let activeLoads = 0;

    const pumpQueue = () => {
      while (activeLoads < concurrency && queue.length > 0) {
        const task = queue.shift();
        activeLoads += 1;

        const image = new Image();
        image.decoding = "async";

        const finish = (result) => {
          if (result && cache.has(task.index)) ready.set(task.index, result);
          task.resolve(result);
          activeLoads -= 1;
          pumpQueue();
        };

        image.onload = async () => {
          if (image.decode) await image.decode().catch(() => {});
          finish(image);
        };
        image.onerror = () => finish(null);
        image.src = urls[task.index];
      }
    };

    const load = (index) => {
      if (cache.has(index)) return cache.get(index);
      const promise = new Promise((resolve) => {
        queue.push({ index, resolve });
        pumpQueue();
      });
      cache.set(index, promise);
      return promise;
    };

    const preloadRange = (start, end) => Promise.all(
      Array.from({ length: end - start + 1 }, (_, offset) => load(start + offset)),
    );

    const queueRange = (start, end) => {
      for (let index = start; index <= end; index += 1) load(index);
    };

    const releaseRange = (start, end) => {
      for (let queueIndex = queue.length - 1; queueIndex >= 0; queueIndex -= 1) {
        const task = queue[queueIndex];
        if (task.index >= start && task.index <= end) {
          queue.splice(queueIndex, 1);
          task.resolve(null);
        }
      }
      for (let index = start; index <= end; index += 1) {
        ready.delete(index);
        cache.delete(index);
      }
    };

    return {
      count,
      getReady: (index) => ready.get(index) || null,
      load,
      preloadRange,
      queueRange,
      releaseRange,
    };
  };

  const envelopeSequence = createSequence("envelope-frames", 86);
  const buttonSequence = createSequence("flower-button-frames", 16);

  const createStage = (id, canvasClass, width, height) => {
    const stage = document.createElement("div");
    stage.id = id;
    stage.setAttribute("aria-hidden", "true");

    const composition = document.createElement("div");
    composition.className = "teacher-day-sequence-composition";

    const canvas = document.createElement("canvas");
    canvas.className = canvasClass;
    canvas.width = width;
    canvas.height = height;
    canvas.dataset.frameIndex = "0";
    canvas.dataset.ready = "loading";
    composition.appendChild(canvas);
    stage.appendChild(composition);

    return { stage, composition, canvas };
  };

  const entry = createStage("teacher-day-entry-stage", "teacher-day-entry-frame", 1080, 812);
  const flowerButton = createStage("teacher-day-button-stage", "teacher-day-button-frame", 720, 799);
  const sendFlower = createStage("teacher-day-send-stage", "teacher-day-send-frame", 900, 572);
  sendFlower.canvas.hidden = true;

  const entryAnimation = new Image();
  entryAnimation.className = "teacher-day-entry-animation";
  entryAnimation.alt = "";
  entryAnimation.decoding = "async";
  entryAnimation.hidden = true;
  entry.composition.appendChild(entryAnimation);

  const trigger = document.createElement("button");
  trigger.id = "teacher-day-flower-trigger";
  trigger.type = "button";
  trigger.disabled = true;
  trigger.title = "送花有惊喜";
  trigger.setAttribute("aria-label", "随机送出一朵教师节鲜花");
  trigger.dataset.state = "entry";
  flowerButton.composition.appendChild(trigger);

  document.body.append(entry.stage, flowerButton.stage, sendFlower.stage);

  let disposed = false;
  let activeFlowerCount = 0;
  let flowerInstanceId = 0;

  const drawFrame = (canvas, image, index) => {
    if (!image || disposed) return false;
    const context = canvas.getContext("2d", { alpha: true });
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    canvas.dataset.frameIndex = String(index);
    return true;
  };

  const clearFrame = (canvas) => {
    const context = canvas.getContext("2d", { alpha: true });
    context.clearRect(0, 0, canvas.width, canvas.height);
    canvas.dataset.frameIndex = "0";
  };

  const playSequence = async (
    sequence,
    canvas,
    start,
    end,
    {
      initialBuffer = 10,
      preloadAll = false,
      releaseBehind = false,
      onStart,
    } = {},
  ) => {
    const bufferEnd = preloadAll ? end : Math.min(end, start + initialBuffer - 1);
    const bufferedFrames = await sequence.preloadRange(start, bufferEnd);
    if (disposed) return false;

    const firstFrame = bufferedFrames[0];
    if (!drawFrame(canvas, firstFrame, start)) return false;
    onStart?.();

    if (!preloadAll && bufferEnd < end) {
      sequence.queueRange(bufferEnd + 1, end);
    }

    const frameCount = end - start + 1;
    const startedAt = performance.now();
    let drawnIndex = start;

    return new Promise((resolve) => {
      const tick = (now) => {
        if (disposed) {
          resolve(false);
          return;
        }

        const elapsed = now - startedAt;
        const targetIndex = Math.min(end, start + Math.floor(elapsed / FRAME_DURATION));
        if (targetIndex > drawnIndex) {
          let readyIndex = targetIndex;
          while (readyIndex > drawnIndex && !sequence.getReady(readyIndex)) {
            readyIndex -= 1;
          }
          if (readyIndex > drawnIndex) {
            const previousIndex = drawnIndex;
            if (drawFrame(canvas, sequence.getReady(readyIndex), readyIndex)) {
              drawnIndex = readyIndex;
              if (releaseBehind) sequence.releaseRange(previousIndex, readyIndex - 1);
            }
          }
        }

        if (elapsed >= frameCount * FRAME_DURATION) {
          resolve(true);
          return;
        }
        requestAnimationFrame(tick);
      };

      requestAnimationFrame(tick);
    });
  };

  const showButton = async () => {
    const image = await buttonSequence.load(0);
    if (disposed || !image) return;

    flowerButton.canvas.dataset.ready = "true";
    drawFrame(flowerButton.canvas, image, 0);
    flowerButton.stage.classList.add("is-visible");
    trigger.disabled = false;
    trigger.dataset.state = "ready";
  };

  const preloadFlowerAssets = () => {
    for (let index = 0; index < FLOWER_COUNT; index += 1) {
      const image = new Image();
      image.decoding = "async";
      image.src = assetUrl(`flower-assets/flower-${index}.png`);
    }
  };

  const playRandomFlower = () => {
    if (trigger.disabled || disposed) return;

    const variant = Math.floor(Math.random() * FLOWER_COUNT);
    const instance = new Image();
    const instanceId = flowerInstanceId;
    flowerInstanceId += 1;

    instance.className = "teacher-day-send-flower";
    instance.alt = "";
    instance.decoding = "async";
    instance.dataset.variant = String(variant);
    instance.dataset.instance = String(instanceId);
    const endX = Math.round((Math.random() - 0.5) * window.innerWidth * 0.64);
    const endY = -Math.round(window.innerHeight * (0.22 + Math.random() * 0.26));
    const curveX = Math.round((Math.random() - 0.5) * window.innerWidth * 0.18);
    const controlX = Math.round(endX * 0.28 + curveX);
    const controlY = Math.round(endY * 0.52);
    instance.style.offsetPath = `path("M 0 0 Q ${controlX} ${controlY} ${endX} ${endY}")`;
    instance.style.setProperty("--flower-rotation", `${Math.round((Math.random() - 0.5) * 44)}deg`);
    instance.style.setProperty("--flower-scale", `${(0.72 + Math.random() * 0.34).toFixed(2)}`);

    const removeInstance = () => {
      if (!instance.isConnected) return;
      instance.remove();
      activeFlowerCount = Math.max(0, activeFlowerCount - 1);
      sendFlower.stage.dataset.activeCount = String(activeFlowerCount);
      if (activeFlowerCount === 0) {
        sendFlower.stage.classList.remove("is-visible");
        sendFlower.stage.dataset.state = "idle";
      }
    };

    instance.addEventListener("load", () => {
      if (disposed) {
        removeInstance();
        return;
      }
      instance.classList.add("is-playing");
      window.setTimeout(removeInstance, 2200);
    }, { once: true });
    instance.addEventListener("error", removeInstance, { once: true });

    activeFlowerCount += 1;
    sendFlower.stage.dataset.variant = String(variant);
    sendFlower.stage.dataset.activeCount = String(activeFlowerCount);
    sendFlower.stage.dataset.state = "playing";
    sendFlower.stage.classList.add("is-visible");
    sendFlower.composition.appendChild(instance);
    instance.src = assetUrl(`flower-assets/flower-${variant}.png`);
  };

  const playEntryAnimation = async () => {
    let objectUrl = null;
    try {
      const response = await fetch(assetUrl("envelope-animation.webp"), {
        cache: "force-cache",
        priority: "high",
      });
      if (!response.ok) return false;

      const animationBlob = await response.blob();
      if (disposed) return false;
      objectUrl = URL.createObjectURL(animationBlob);

      const loaded = await new Promise((resolve) => {
        entryAnimation.onload = () => resolve(true);
        entryAnimation.onerror = () => resolve(false);
        entryAnimation.src = objectUrl;
      });
      if (!loaded || disposed) return false;

      entry.canvas.hidden = true;
      entryAnimation.hidden = false;
      entry.canvas.dataset.ready = "true";
      entry.canvas.dataset.renderer = "animated-webp";
      entry.stage.dataset.state = "playing";
      entry.stage.classList.add("is-visible");
      preloadFlowerAssets();

      await new Promise((resolve) => setTimeout(resolve, ENTRY_ANIMATION_DURATION));
      if (disposed) return false;

      entry.stage.classList.remove("is-visible");
      return true;
    } catch {
      return false;
    } finally {
      entryAnimation.onload = null;
      entryAnimation.onerror = null;
      entryAnimation.hidden = true;
      entryAnimation.removeAttribute("src");
      entry.canvas.hidden = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    }
  };

  const playEntry = async () => {
    entry.stage.dataset.state = "loading";
    const animationPlayed = await playEntryAnimation();
    if (!animationPlayed && !disposed) {
      await playSequence(envelopeSequence, entry.canvas, 0, envelopeSequence.count - 1, {
        initialBuffer: 24,
        releaseBehind: true,
        onStart: () => {
          entry.canvas.dataset.ready = "true";
          entry.canvas.dataset.renderer = "frame-sequence";
          entry.stage.dataset.state = "playing";
          entry.stage.classList.add("is-visible");
          preloadFlowerAssets();
        },
      });
      entry.stage.classList.remove("is-visible");
    }

    entry.stage.dataset.state = "complete";
    clearFrame(entry.canvas);
    envelopeSequence.releaseRange(0, envelopeSequence.count - 1);
    await showButton();
  };

  trigger.addEventListener("click", playRandomFlower);
  window.addEventListener("pagehide", () => {
    disposed = true;
  }, { once: true });

  buttonSequence.load(0);
  playEntry();
})();
