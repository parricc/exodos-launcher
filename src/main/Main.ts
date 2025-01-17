import { SharedSocket } from "@shared/back/SharedSocket";
import * as remoteMain from "@electron/remote/main";
import {
    BackIn,
    BackInitArgs,
    BackOut,
    GetMainInitDataResponse,
    SetLocaleData,
    WrappedRequest,
    WrappedResponse,
} from "@shared/back/types";
import { IAppConfigData } from "@shared/config/interfaces";
import { APP_TITLE } from "@shared/constants";
import { WindowIPC } from "@shared/interfaces";
import { InitRendererChannel, InitRendererData } from "@shared/IPC";
import { IAppPreferencesData, IAppPreferencesDataMainWindow } from "@shared/preferences/interfaces";
import { createErrorProxy } from "@shared/Util";
import { ChildProcess, fork } from "child_process";
import { randomBytes } from "crypto";
import {
    app,
    BrowserWindow,
    dialog,
    ipcMain,
    IpcMainEvent,
    session,
    shell,
} from "electron";
import * as fs from "fs";
import * as path from "path";
import { promisify } from "util";
import * as WebSocket from "ws";
import { Init } from "./types";
import * as Util from "./Util";

const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);

const TIMEOUT_DELAY = 60_000;

type MainState = {
    window?: BrowserWindow;
    _installed?: boolean;
    backHost: URL;
    _secret: string;
    /** Version of the launcher (timestamp of when it was built). Negative value if not found or not yet loaded. */
    _version: number;
    preferences?: IAppPreferencesData;
    config?: IAppConfigData;
    socket: SharedSocket<WebSocket>;
    backProc?: ChildProcess;
    _sentLocaleCode: boolean;
    /** If the main is about to quit. */
    isQuitting: boolean;
    /** Path of the folder containing the config and preferences files. */
    mainFolderPath: string;
};

export function main(init: Init): void {
    const state: MainState = {
        window: undefined,
        _installed: undefined,
        backHost: init.args["connect-remote"]
            ? new URL("ws://" + init.args["connect-remote"])
            : new URL("ws://127.0.0.1"),
        _secret: "",
        /** Version of the launcher (timestamp of when it was built). Negative value if not found or not yet loaded. */
        _version: -2,
        preferences: undefined,
        config: undefined,
        socket: new SharedSocket(WebSocket),
        backProc: undefined,
        _sentLocaleCode: false,
        isQuitting: false,
        mainFolderPath: createErrorProxy("mainFolderPath"),
    };

    startup();

    function startup() {
        if (process.env.APPIMAGE) {
            app.commandLine.appendSwitch('no-sandbox');
        }
        app.disableHardwareAcceleration();

        // Add app event listener(s)
        app.once("ready", onAppReady);
        app.once("window-all-closed", onAppWindowAllClosed);
        app.once("will-quit", onAppWillQuit);
        app.once("web-contents-created", onAppWebContentsCreated);
        app.on("activate", onAppActivate);

        // Add IPC event listener(s)
        ipcMain.on(InitRendererChannel, onInit);

        // Add Socket event listener(s)
        state.socket.on("message", onMessage);

        // ---- Initialize ----
        // Check if installed
        let p = exists("./.installed")
            .then((exists) => {
                state._installed = exists;
                state.mainFolderPath = Util.getMainFolderPath();
                console.log('Main folder: ' + state.mainFolderPath);
            })
            // Load version number
            .then(
                () =>
                    new Promise((resolve) => {
                        fs.readFile(
                            path.join(state.mainFolderPath, ".version"),
                            (_, data) => {
                                state._version = data
                                    ? parseInt(
                                          data.toString().replace(/[^\d]/g, ""),
                                          10
                                      ) // (Remove all non-numerical characters, then parse it as a string)
                                    : -1; // (Version not found error code)
                                resolve(null);
                            }
                        );
                    })
            )
            // Load or generate secret
            .then(async () => {
                if (
                    init.args["connect-remote"] ||
                    init.args["host-remote"] ||
                    init.args["back-only"]
                ) {
                    const secretFilePath = path.join(
                        state.mainFolderPath,
                        "secret.txt"
                    );
                    try {
                        state._secret = await readFile(secretFilePath, {
                            encoding: "utf8",
                        });
                    } catch (e) {
                        state._secret = randomBytes(2048).toString("hex");
                        try {
                            await writeFile(secretFilePath, state._secret, {
                                encoding: "utf8",
                            });
                        } catch (e) {
                            console.warn(
                                `Failed to save new secret to disk.\n${e}`
                            );
                        }
                    }
                } else {
                    state._secret = randomBytes(2048).toString("hex");
                }
            });
        // Start back process
        if (!init.args["connect-remote"]) {
            p = p.then(
                () =>
                    new Promise((resolve, reject) => {
                        state.backProc = fork(
                            path.join(__dirname, "../back/index.js"),
                            undefined,
                            { detached: true }
                        );
                        // Wait for process to initialize
                        state.backProc.once("message", (msg) => {
                            const port = parseInt(msg.toString());
                            if (port >= 0) {
                                state.backHost.port = port.toString();
                                resolve();
                            } else {
                                reject(
                                    new Error(
                                        "Failed to start server in back process. Perhaps because it could not find an available port."
                                    )
                                );
                            }
                        });
                        // On windows you have to wait for app to be ready before you call app.getLocale() (so it will be sent later)
                        let localeCode: string = "en";
                        if (process.platform === "win32" && !app.isReady()) {
                            localeCode = "en";
                        } else {
                            localeCode = app.getLocale().toLowerCase();
                            state._sentLocaleCode = true;
                        }
                        // Send initialize message
                        const msg: BackInitArgs = {
                            configFolder: state.mainFolderPath,
                            secret: state._secret,
                            isDev: Util.isDev,
                            // On windows you have to wait for app to be ready before you call app.getLocale() (so it will be sent later)
                            localeCode: localeCode,
                            exePath: path.dirname(app.getPath("exe")),
                            basePath: process.env.APPIMAGE ? path.dirname(app.getPath('appData')) : process.cwd(),
                            acceptRemote: !!init.args["host-remote"],
                        };
                        state.backProc.send(JSON.stringify(msg));
                    })
            );
        }
        // Connect to back and start renderer
        if (!init.args["back-only"]) {
            // Connect to back process
            p = p
                .then<WebSocket>(() =>
                    timeout(
                        new Promise((resolve, reject) => {
                            const ws = new WebSocket(state.backHost.href);
                            ws.onclose = () => {
                                reject(
                                    new Error(
                                        "Failed to authenticate connection to back."
                                    )
                                );
                            };
                            ws.onerror = (event) => {
                                reject(event.error);
                            };
                            ws.onopen = () => {
                                ws.onmessage = () => {
                                    ws.onclose = noop;
                                    ws.onerror = noop;
                                    resolve(ws);
                                };
                                ws.send(state._secret);
                            };
                        }),
                        TIMEOUT_DELAY
                    )
                )
                // Send init message
                .then((ws) =>
                    timeout(
                        new Promise((resolve, _) => {
                            ws.onmessage = (event) => {
                                const res: WrappedResponse = JSON.parse(
                                    event.data.toString()
                                );
                                if (res.type === BackOut.GET_MAIN_INIT_DATA) {
                                    const data: GetMainInitDataResponse =
                                        res.data;
                                    state.preferences = data.preferences;
                                    state.config = data.config;
                                    state.socket.setSocket(ws);
                                    resolve(null);
                                }
                            };
                            const req: WrappedRequest = {
                                id: "init",
                                type: BackIn.GET_MAIN_INIT_DATA,
                                data: undefined,
                            };
                            ws.send(JSON.stringify(req));
                        }),
                        TIMEOUT_DELAY
                    )
                )
                // Create main window
                .then(() =>
                    app.whenReady().then(() => {
                        createMainWindow();
                    })
                );
        }
        // Catch errors
        p.catch((error) => {
            console.error(error);
            if (!Util.isDev) {
                dialog.showMessageBoxSync({
                    title: "Failed to start launcher!",
                    type: "error",
                    message:
                        "Something went wrong while starting the launcher.\n\n" +
                        error,
                });
            }
            state.socket.disconnect();
            app.quit();
        });
    }

    function onMessage(res: WrappedResponse): void {
        switch (res.type) {
            case BackOut.QUIT:
                {
                    state.isQuitting = true;
                    app.quit();
                }
                break;
        }
    }

    function onAppReady(): void {
        if (!session.defaultSession) {
            throw new Error("Default session is missing!");
        }
        // Send locale code (if it has no been sent already)
        if (process.platform === "win32" && !state._sentLocaleCode) {
            const didSend = state.socket.send<any, SetLocaleData>(
                BackIn.SET_LOCALE,
                app.getLocale().toLowerCase()
            );
            if (didSend) {
                state._sentLocaleCode = true;
            }
        }
        // Reject all permission requests since we don't need any permissions.
        session.defaultSession.setPermissionRequestHandler(
            (_, __, callback) => callback(false)
        );
        // Ignore proxy settings with chromium APIs (makes WebSockets not close when the Redirector changes proxy settings)
        session.defaultSession.setProxy({
            pacScript: "",
            proxyRules: "",
            proxyBypassRules: "",
        });
    }

    function onAppWindowAllClosed(): void {
        // On OS X it is common for applications and their menu bar
        // to stay active until the user quits explicitly with Cmd + Q
        if (process.platform !== "darwin") {
            app.quit();
        }
    }

    function onAppWillQuit(event: Electron.Event): void {
        if (!init.args["connect-remote"] && !state.isQuitting) {
            // (Local back)
            const result = state.socket.send(BackIn.QUIT, undefined);
            if (result) {
                event.preventDefault();
            }
        }
    }

    function onAppWebContentsCreated(
        _event: Electron.Event,
        webContents: Electron.WebContents
    ): void {
        // Open links to web pages in the OS-es default browser
        // (instead of navigating to it with the electron window that opened it)
        webContents.on("will-navigate", onNewPage);
        webContents.setWindowOpenHandler((details) => {
            shell.openExternal(details.url);
            return { action: "deny" };
        });

        function onNewPage(event: Electron.Event, navigationUrl: string): void {
            event.preventDefault();
            shell.openExternal(navigationUrl);
        }
    }

    function onAppActivate(): void {
        // On OS X it's common to re-create a window in the app when the
        // dock icon is clicked and there are no other windows open.
        if (!state.window) {
            createMainWindow();
        }
    }

    function onInit(event: IpcMainEvent) {
        const data: InitRendererData = {
            isBackRemote: !!init.args["connect-remote"],
            installed: !!state._installed,
            version: state._version,
            host: state.backHost.href,
            secret: state._secret,
        };
        event.returnValue = data;
    }

    function exists(filePath: string): Promise<boolean> {
        return new Promise((resolve) => {
            fs.stat(filePath, (error, stats) => {
                if (error) {
                    resolve(false);
                } else {
                    resolve(stats.isFile());
                }
            });
        });
    }

    function getInitialWindowSize(): IAppPreferencesDataMainWindow {
        if (!state.preferences) {
            throw new Error(
                "Preferences must be set before you can open a window."
            );
        }
        if (!state.config) {
            throw new Error(
                "Configs must be set before you can open a window."
            );
        }
        if (process.env.SteamDeck && process.env.XDG_CURRENT_DESKTOP === "gamescope") {
            console.log('Running via deck, forcing 1280x800 resolution');
            return {
                width: 1280,
                height: 800,
                x: 0,
                y: 0,
                maximized: false,
            }
        } else {
            const mw = state.preferences.mainWindow;
            let width: number = mw.width ? mw.width : 1000;
            let height: number = mw.height ? mw.height : 650;
            if (mw.width && mw.height && !state.config.useCustomTitlebar) {
                width += 8; // Add the width of the window-grab-things,
                height += 8; // they are 4 pixels wide each (at least for me @TBubba)
            }
            return {
                width,
                height,
                x: state.preferences.mainWindow.x,
                y: state.preferences.mainWindow.y,
                maximized: state.preferences.mainWindow.maximized,
            }
        }
    }

    function createMainWindow(): BrowserWindow {
        if (!state.preferences) {
            throw new Error(
                "Preferences must be set before you can open a window."
            );
        }
        if (!state.config) {
            throw new Error(
                "Configs must be set before you can open a window."
            );
        }
        // Create the browser window.
        const mw = getInitialWindowSize();

        remoteMain.initialize();
        const window = new BrowserWindow({
            title: APP_TITLE,
            x: mw.x,
            y: mw.y,
            width: mw.width,
            height: mw.height,
            frame: !state.config.useCustomTitlebar,
            icon: path.join(__dirname, "../window/images/icon.png"),
            webPreferences: {
                preload: path.resolve(__dirname, "./MainWindowPreload.js"),
                nodeIntegration: true,
                contextIsolation: false,
            },
        });
        remoteMain.enable(window.webContents);
        // Remove the menu bar
        window.setMenuBarVisibility(false);
        // and load the index.html of the app.
        window.loadFile(path.join(__dirname, "../window/index.html"));
        // Open the DevTools. Don't open if using a remote debugger (like vscode)
        if (Util.isDev && !process.env.REMOTE_DEBUG) {
            window.webContents.openDevTools();
        }
        // Maximize window
        if (mw.maximized) {
            window.maximize();
        }

        window.on("move", () => {
            if (!window) {
                throw new Error();
            }
            const pos = window.getPosition();
            const isMaximized = window.isMaximized();
            window.webContents.send(
                WindowIPC.WINDOW_MOVE,
                pos[0],
                pos[1],
                isMaximized
            );
        });
        // Replay window's move event to the renderer
        window.on("resize", () => {
            if (!window) {
                throw new Error();
            }
            const size = window.getSize();
            const isMaximized = window.isMaximized();
            window.webContents.send(
                WindowIPC.WINDOW_RESIZE,
                size[0],
                size[1],
                isMaximized
            );
        });
        // Derefence window when closed
        window.on("closed", () => {
            if (state.window === window) {
                state.window = undefined;
            }
        });
        return window;
    }

    /**
     * Resolves/Rejects when the wrapped promise does. Rejects if the timeout happens before that.
     * @param promise Promise to wrap.
     * @param ms Time to wait before timing out (in ms).
     */
    function timeout<T>(promise: Promise<T>, ms: number): Promise<T> {
        return new Promise((resolve, reject) => {
            const handle = setTimeout(() => {
                reject(
                    new Error(`Timeout (${(ms / 1000).toFixed(1)} seconds).`)
                );
            }, ms);
            promise
                .then((arg) => {
                    clearTimeout(handle);
                    resolve(arg);
                })
                .catch((error) => {
                    clearTimeout(handle);
                    reject(error);
                });
        });
    }

    function noop() {}
}
