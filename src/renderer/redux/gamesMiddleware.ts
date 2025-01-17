import { isAnyOf } from "@reduxjs/toolkit";
import { readPlatformsFile } from "@renderer/file/PlatformFile";
import { formatPlatformFileData } from "@renderer/util/LaunchBoxHelper";
import { GameParser } from "@shared/game/GameParser";
import * as fs from "fs";
import * as path from "path";
import {
    GamesInitState,
    initialize,
    setGames,
    setLibraries,
} from "./gamesSlice";
import { startAppListening } from "./listenerMiddleware";
import { initializeViews } from "./searchSlice";
import { IGameCollection } from "@shared/game/interfaces";
import { GameCollection } from "@shared/game/GameCollection";
import {
    createVideosWatcher,
    loadPlatformImages,
    loadPlatformVideos,
    mapGamesMedia,
} from "@renderer/util/media";
import { createManualsWatcher } from "@renderer/util/addApps";
import { createGamesWatcher } from "@renderer/util/games";
import { XMLParser } from "fast-xml-parser";

// @TODO - watchable platforms should be defined in seperate file to be easily adjustable, ideally in the json cfg file
const watchablePlatforms = ["MS-DOS"];

export function addGamesMiddleware() {
    startAppListening({
        matcher: isAnyOf(initialize),
        effect: async (_action, listenerApi) => {
            const state = listenerApi.getState();
            if (state.gamesState.initState === GamesInitState.LOADED) {
                return; // Already loaded
            }

            const startTime = Date.now();
            const libraries: string[] = [];
            const collection: GameCollection = new GameCollection();

            const platformsPath = path.join(
                window.External.config.fullExodosPath,
                window.External.config.data.platformFolderPath
            );
            const { platforms } = await readPlatformsFile(
                path.join(platformsPath, "../Platforms.xml")
            );

            for (const platform of platforms) {
                const platformCollection = await loadPlatform(
                    platform,
                    platformsPath
                );
                if (platformCollection.games.length > 0) {
                    libraries.push(platform);
                }
                collection.push(platformCollection);
                if (watchablePlatforms.includes(platform)) {
                    createGamesWatcher(platformCollection);
                    createVideosWatcher(platform);
                    createManualsWatcher(platform);
                }
            }
            console.debug(`Load time - ${Date.now() - startTime}ms`);
            libraries.sort();
            listenerApi.dispatch(setLibraries(libraries));
            listenerApi.dispatch(initializeViews(libraries));
            listenerApi.dispatch(setGames(collection.forRedux()));
        },
    });
}

async function loadPlatform(platform: string, platformsPath: string) {
    console.log(`Loading platform ${platform} from ${platformsPath}`);

    try {
        const platformFile = path.join(platformsPath, `${platform}.xml`);
        console.debug(
            `Checking existence of platform ${platformFile} xml file..`
        );

        if ((await fs.promises.stat(platformFile)).isFile()) {
            console.debug(`Platform file found: ${platformFile}`);

            const content = await fs.promises.readFile(platformFile, {
                encoding: "utf-8",
            });

            const parser = new XMLParser();
            const data: any | undefined = parser.parse(content.toString());

            if (!formatPlatformFileData(data)) {
                throw new Error(`Failed to parse XML file: ${platformFile}`);
            }

            const startTime = Date.now();
            const images = await loadPlatformImages(platform);
            console.log(`Images - ${Date.now() - startTime}`);
            const videos = loadPlatformVideos(platform);
            console.log(`Videos - ${Date.now() - startTime}`);

            const platformCollection = GameParser.parse(
                data,
                platform,
                window.External.config.fullExodosPath
            );

            console.log(`Parsing - ${Date.now() - startTime}`);

            for (const game of platformCollection.games) {
                mapGamesMedia(game, images, videos);
            }

            console.log(`Add apps - ${Date.now() - startTime}`);

            return platformCollection;
        } else {
            console.log(`Platform file not found: ${platformFile}`);
        }
    } catch (error) {
        console.error(`Failed to load Platform "${platform}": ${error}`);
    }

    return { games: [], addApps: [] } as IGameCollection;
}

export type ErrorCopy = {
    columnNumber?: number;
    fileName?: string;
    lineNumber?: number;
    message: string;
    name: string;
    stack?: string;
};

export type LoadPlatformError = ErrorCopy & {
    /** File path of the platform file the error is related to. */
    filePath: string;
};
