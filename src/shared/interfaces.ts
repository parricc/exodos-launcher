import { IGameInfo } from './game/interfaces';
import { AppPreferencesApi } from './preferences/AppPreferencesApi';
import { AppConfigApi } from './config/AppConfigApi';

export interface IMainWindowExternal {
  /**
   * Launch a LaunchBox Game (using its settings)
   * (WARNING: This will run an arbitrary program file with arbitrary arguments)
   * @param game
   */
  launchGameSync(game: IGameInfo): void;

  /** ask the main to resend the log-data-update event */
  resendLogDataUpdate(): void;

  /** Get the OS name */
  platform: NodeJS.Platform;

  // -- Window functions --

  /** Minimize the window */
  minimize(): void;

  /** Maximize the window (or un-maximize if already maximized) */
  maximize(): void;

  /** Close the window */
  close(): void;

  /** Restart the application (closes all windows) */
  restart(): void;

  /** Wrapper of Electron.dialog.showOpenDialog() */
  showOpenDialog(options: Electron.OpenDialogOptions, callback?: ElectronOpenDialogCallback): string[]|undefined;

  /** Renderer's interface for the Preferences data */
  preferences: AppPreferencesApi;

  /** Renderer's interface for the Config data */
  config: AppConfigApi;
}

/** Callback for Electron.dialog.showOpenDialog */
export type ElectronOpenDialogCallback = (filePaths?: string[], bookmarks?: string[]) => void;
