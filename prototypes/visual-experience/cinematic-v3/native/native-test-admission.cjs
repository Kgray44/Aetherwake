const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const permitName = "permit.json";
const leaseName = "lease.json";
const pauseName = "gaming.json";
const availabilityName = "availability.json";
const availabilityMs = 120 * 60_000;

function refuse(code) {
  throw Object.assign(new Error(code), { code });
}

function desktopDirectory() {
  if (process.platform !== "win32") return null;
  const local = process.env.LOCALAPPDATA;
  if (!local || !path.isAbsolute(local)) refuse("native_test_desktop_directory_unavailable");
  return path.join(local, "Aerynth", "native-test-admission-v1");
}

function createAdmission(directory, now = Date.now) {
  function read(name) {
    try {
      const value = JSON.parse(fs.readFileSync(path.join(directory, name), "utf8"));
      if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("invalid state");
      return value;
    } catch (error) {
      if (error.code === "ENOENT") return null;
      refuse("native_test_desktop_state_unreadable");
    }
  }

  function create(name, value) {
    try {
      fs.writeFileSync(path.join(directory, name), JSON.stringify(value), { flag: "wx" });
    } catch (error) {
      if (error.code === "EEXIST") refuse("native_test_desktop_slot_busy");
      throw error;
    }
  }

  function status() {
    const permit = read(permitName);
    const lease = read(leaseName);
    return {
      gaming: read(pauseName) !== null,
      confirmedAt: read(availabilityName)?.confirmedAt ?? null,
      permit: permit && { owner: permit.owner, expiresAt: permit.expiresAt, expired: permit.expiresAt <= now() },
      lease: lease && { owner: lease.owner, pid: lease.pid },
    };
  }

  function open(owner, minutes) {
    if (!/^[a-z0-9][a-z0-9-]{0,79}$/i.test(owner ?? "") ||
        !Number.isInteger(minutes) || minutes < 1 || minutes > 120) {
      refuse("native_test_desktop_owner_or_duration_invalid");
    }
    fs.mkdirSync(directory, { recursive: true });
    const availability = checkAvailability();
    if (read(leaseName)) refuse("native_test_desktop_slot_busy");
    const permit = {
      owner, token: randomUUID(), availabilityId: availability.id,
      expiresAt: Math.min(now() + minutes * 60_000, availability.confirmedAt + availabilityMs),
    };
    create(permitName, permit);
    checkPermit(permit.token);
    return permit;
  }

  function remove(name) {
    try {
      fs.unlinkSync(path.join(directory, name));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }

  function close() { remove(permitName); }

  function pause() {
    fs.mkdirSync(directory, { recursive: true });
    try {
      create(pauseName, { startedAt: now() });
    } catch (error) {
      if (error.code !== "native_test_desktop_slot_busy") throw error;
    }
    remove(availabilityName);
    close();
  }

  function resume(confirmedAt) {
    const gaming = read(pauseName);
    if (!Number.isSafeInteger(confirmedAt) || confirmedAt > now() ||
        confirmedAt + availabilityMs <= now() ||
        (gaming && (!Number.isSafeInteger(gaming.startedAt) || confirmedAt <= gaming.startedAt))) {
      refuse("native_test_desktop_confirmation_invalid");
    }
    fs.mkdirSync(directory, { recursive: true });
    close();
    remove(availabilityName);
    create(availabilityName, { confirmedAt, id: randomUUID() });
    remove(pauseName);
  }

  function checkAvailability() {
    if (read(pauseName)) refuse("native_test_desktop_gaming");
    const availability = read(availabilityName);
    if (!availability || typeof availability.id !== "string" ||
        !Number.isSafeInteger(availability.confirmedAt) || availability.confirmedAt > now() ||
        availability.confirmedAt + availabilityMs <= now()) {
      refuse("native_test_desktop_availability_unconfirmed");
    }
    return availability;
  }

  function checkPermit(token) {
    const availability = checkAvailability();
    const permit = read(permitName);
    if (!permit || typeof token !== "string" || token.length === 0 || permit.token !== token ||
        permit.availabilityId !== availability.id ||
        !Number.isSafeInteger(permit.expiresAt) || permit.expiresAt <= now()) {
      refuse("native_test_desktop_slot_closed");
    }
    return permit;
  }

  function checkLease(token, pid) {
    checkPermit(token);
    const lease = read(leaseName);
    if (lease?.pid !== pid || lease.token !== token) refuse("native_test_desktop_lease_lost");
  }

  function claim(token, pid) {
    const { owner } = checkPermit(token);
    const id = randomUUID();
    create(leaseName, { id, owner, pid, token });
    function release() {
      if (read(leaseName)?.id === id) fs.unlinkSync(path.join(directory, leaseName));
    }
    try {
      checkLease(token, pid);
    } catch (error) {
      release();
      throw error;
    }
    return { check: () => checkLease(token, pid), release };
  }

  return { open, close, pause, resume, status, checkPermit, checkLease, claim };
}

function verificationLaunch(args) {
  return args.some(arg => arg.startsWith("--integration-") ||
    arg.startsWith("--remote-debugging-port") ||
    arg === "--aerynth-capture-visible" || arg === "--check-model-catalog" || arg === "--native-test");
}

function installDesktopTestAdmission({ app, BrowserWindow, terminate = () => app.exit(2) }) {
  let directory;
  let lease;
  try {
    directory = desktopDirectory();
    if (!directory) return { check: () => {}, BrowserWindow };
    lease = createAdmission(directory).claim(process.env.AERYNTH_NATIVE_TEST_SLOT, process.pid);
  } catch (error) {
    // Throwing from Electron's main module can display its startup error dialog.
    console.error(error.code ?? "native_test_desktop_admission_failed");
    process.exit(2);
  }

  const release = () => {
    try {
      lease.release();
    } catch (error) {
      console.error(error.code ?? "native_test_desktop_lease_release_failed");
    }
  };
  app.once("quit", release);
  process.once("exit", release);
  process.on("uncaughtException", (error) => {
    console.error(error.stack ?? error);
    terminate();
  });
  process.on("unhandledRejection", (error) => {
    console.error(error?.stack ?? error);
    terminate();
  });
  let revoked = false;
  function check() {
    try {
      lease.check();
    } catch (error) {
      if (!revoked) {
        revoked = true;
        console.error(error.code);
        try {
          for (const win of BrowserWindow.getAllWindows()) {
            if (!win.isDestroyed()) win.hide();
          }
        } finally {
          terminate();
        }
      }
      throw error;
    }
  }

  // Fence all windows created by this verifier, including modal child windows.
  app.on("browser-window-created", (_event, win) => {
    for (const method of ["show", "showInactive", "focus", "restore", "maximize", "setFullScreen", "setKiosk"]) {
      const original = win[method];
      if (typeof original !== "function") continue;
      win[method] = function (...args) {
        check();
        return original.apply(this, args);
      };
    }
    check();
    const contents = win.webContents;
    const sendInputEvent = contents.sendInputEvent;
    contents.sendInputEvent = function (event) {
      check();
      return sendInputEvent.call(this, event);
    };
  });
  const watcher = setInterval(() => {
    try { check(); } catch { /* Revocation already stopped this verifier. */ }
  }, 200);
  watcher.unref();
  return {
    check,
    BrowserWindow: new Proxy(BrowserWindow, {
      construct(target, args, newTarget) {
        check();
        return Reflect.construct(target, args, newTarget);
      },
    }),
  };
}

module.exports = { createAdmission, desktopDirectory, installDesktopTestAdmission, verificationLaunch };
