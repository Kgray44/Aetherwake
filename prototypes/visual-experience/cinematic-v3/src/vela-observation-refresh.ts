type Timer = ReturnType<typeof setTimeout>;

/** Owns observation scheduling; the Vela client still owns observation fencing. */
export function createVelaObservationRefresh({
  available,
  read,
  failed,
  timer = { set: setTimeout, clear: clearTimeout },
}: {
  available(): boolean;
  read(): Promise<unknown>;
  failed(error: unknown): void;
  timer?: {
    set(callback: () => void, delay: number): Timer;
    clear(id: Timer): void;
  };
}) {
  let pending: Timer | undefined;
  let reading = false;
  let active = false;
  let stopped = false;

  function request(delay = 150) {
    if (stopped || pending !== undefined || reading || !available()) return;
    pending = timer.set(() => {
      pending = undefined;
      if (stopped || !available()) return;
      void observe();
    }, delay);
  }

  async function observe() {
    reading = true;
    try {
      await read();
    } catch (error) {
      if (!stopped) {
        if (
          error instanceof Error &&
          error.message === "vela_observation_superseded"
        )
          active = true;
        else failed(error);
      }
    } finally {
      reading = false;
      if (active) request(1000);
    }
  }

  return {
    request,
    observeActivity(value: boolean) {
      active = value;
      if (active) request(1000);
    },
    stop() {
      stopped = true;
      if (pending !== undefined) timer.clear(pending);
      pending = undefined;
    },
  };
}
