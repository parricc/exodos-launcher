import * as fs from 'fs';
import * as React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { promisify } from 'util';
import { InputField } from './InputField';
import { EditCuration, CurationAction } from '../context/CurationContext';
import { sizeToString } from '../Util';
import { CurateBoxImage } from './CurateBoxImage';
import { CurateBoxRow } from './CurateBoxRow';
import { IOldCurationMeta } from '../curate/oldFormat';
import { SimpleButton } from './SimpleButton';
import { GameLauncher } from '../GameLauncher';
import { CurationIndexContent } from '../curate/indexCuration';

const fsStat = promisify(fs.stat);

type InputElement = HTMLInputElement | HTMLTextAreaElement;

export type CurateBoxProps = {
  /** Meta data of the curation to display. */
  curation?: EditCuration;
  /** Dispatcher for the curate page state reducer. */
  dispatch: React.Dispatch<CurationAction>;
};

/** A box that displays and lets the user edit a curation. */
export function CurateBox(props: CurateBoxProps) {
  //
  const [contentCollisions, setContentCollisions] = useState<ContentCollision[] | undefined>(undefined);
  // Check for content file collisions
  useEffect(() => {
    if (props.curation) {
      let isAborted = false;
      // Check if there are any content collisions
      checkCollisions(props.curation.content)
      .then((collisions) => {
        if (!isAborted) { setContentCollisions(collisions); }
      })
      .catch(console.error);
      // Ignore the result of the check if the content has changed
      return () => { isAborted = true; };
    }
  }, [props.curation && props.curation.content]);
  // Callbacks for the fields (onChange)
  const key = props.curation ? props.curation.key : undefined;
  const onTitleChange         = useOnInputChance('title',         key, props.dispatch);
  const onSeriesChange        = useOnInputChance('series',        key, props.dispatch);
  const onDeveloperChange     = useOnInputChance('developer',     key, props.dispatch);
  const onPublisherChange     = useOnInputChance('publisher',     key, props.dispatch);
  const onStatusChange        = useOnInputChance('status',        key, props.dispatch);
  const onExtremeChange       = useOnInputChance('extreme',       key, props.dispatch);
  const onGenreChange         = useOnInputChance('genre',         key, props.dispatch);
  const onSourceChange        = useOnInputChance('source',        key, props.dispatch);
  const onLaunchCommandChange = useOnInputChance('launchCommand', key, props.dispatch);
  const onNotesChange         = useOnInputChance('notes',         key, props.dispatch);
  const onAuthorNotesChange   = useOnInputChance('authorNotes',   key, props.dispatch);
  // Callback for the fields (onInputKeyDown)
  const onInputKeyDown = useCallback(() => {
    // ...
  }, []);
  // Callback for when the import button is clicked
  const onImportClick = useCallback(() => {
    // @TODO (just do it already)
  }, [props.curation]);
  // Callback for when the remove button is clicked
  const onRemoveClick = useCallback(() => {
    if (props.curation) {
      props.dispatch({
        type: 'remove-curation',
        payload: { key: props.curation.key }
      });
    }
  }, [props.dispatch, props.curation && props.curation.key]);
  // Count the number of collisions
  const collisionCount: number | undefined = useMemo(() => {
    return contentCollisions && contentCollisions.reduce((v, c) => v + (c.fileExists ? 1 : 0), 0);
  }, [contentCollisions]);
  // Render content (files and folders inside the "content" folder)
  const contentFilenames = useMemo(() => {
    return props.curation && props.curation.content.map((content, index) => {
      const collision = contentCollisions && contentCollisions[index];
      // Folders file names ends with '/' and have a file size of 0
      const isFolder = (
        content.fileName[content.fileName.length - 1] === '/' &&
        content.fileSize === 0
      );
      // Render content element
      const contentElement = (
        <span className='curate-box-files__entry'>
          {content.fileName + (isFolder ? '' : `(${sizeToString(content.fileSize)})`)}
        </span>
      );
      // Render collision element
      const collisionElement = (collision && collision.fileExists) ? (
        <span className='curate-box-files__entry-collision'>
          {' - Already Exists ' + (collision.isFolder ? '' : `(${sizeToString(content.fileSize)})`)}
        </span>
      ) : undefined;
      // Render
      return (
        <span key={index}>
          {contentElement}
          {collisionElement}
          {'\n'}
        </span>
      );
    });
  }, [props.curation && props.curation.content, contentCollisions]);
  //
  const canEdit = true;
  // Render
  return (
    <div className='curate-box'>
      {/* Images */}
      <div className='curate-box-image-titles'>
        <p className='curate-box-image-titles__title'>Thumbnail</p>
        <p className='curate-box-image-titles__title'>Screenshot</p>
      </div>
      <div className='curate-box-images'>
        <CurateBoxImage image={props.curation && props.curation.thumbnail} />
        <CurateBoxImage image={props.curation && props.curation.screenshot} />
      </div>
      {/* Fields */}
      <CurateBoxRow title='Title:'>
        <InputField
          text={props.curation && props.curation.meta.title || ''}
          placeholder='No Title'
          onChange={onTitleChange}
          canEdit={canEdit}
          onKeyDown={onInputKeyDown} />
      </CurateBoxRow>
      <CurateBoxRow title='Series:'>
        <InputField
          text={props.curation && props.curation.meta.series || ''}
          placeholder='No Series'
          onChange={onSeriesChange}
          canEdit={canEdit}
          onKeyDown={onInputKeyDown} />
      </CurateBoxRow>
      <CurateBoxRow title='Developer:'>
        <InputField
          text={props.curation && props.curation.meta.developer || ''}
          placeholder='No Developer'
          onChange={onDeveloperChange}
          canEdit={canEdit}
          onKeyDown={onInputKeyDown} />
      </CurateBoxRow>
      <CurateBoxRow title='Publisher:'>
        <InputField
          text={props.curation && props.curation.meta.publisher || ''}
          placeholder='No Publisher'
          onChange={onPublisherChange}
          canEdit={canEdit}
          onKeyDown={onInputKeyDown} />
      </CurateBoxRow>
      <CurateBoxRow title='Status:'>
        <InputField
          text={props.curation && props.curation.meta.status || ''}
          placeholder='No Status'
          onChange={onStatusChange}
          canEdit={canEdit}
          onKeyDown={onInputKeyDown} />
      </CurateBoxRow>
      <CurateBoxRow title='Extreme:'>
        <InputField
          text={props.curation && props.curation.meta.extreme || ''}
          placeholder='No Extreme'
          onChange={onExtremeChange}
          canEdit={canEdit}
          onKeyDown={onInputKeyDown} />
      </CurateBoxRow>
      <CurateBoxRow title='Genre:'>
        <InputField
          text={props.curation && props.curation.meta.genre || ''}
          placeholder='No Genre'
          onChange={onGenreChange}
          canEdit={canEdit}
          onKeyDown={onInputKeyDown} />
      </CurateBoxRow>
      <CurateBoxRow title='Source:'>
        <InputField
          text={props.curation && props.curation.meta.source || ''}
          placeholder='No Source'
          onChange={onSourceChange}
          canEdit={canEdit}
          onKeyDown={onInputKeyDown} />
      </CurateBoxRow>
      <CurateBoxRow title='Launch Command:'>
        <InputField
          text={props.curation && props.curation.meta.launchCommand || ''}
          placeholder='No Launch Command'
          onChange={onLaunchCommandChange}
          canEdit={canEdit}
          onKeyDown={onInputKeyDown} />
      </CurateBoxRow>
      <CurateBoxRow title='Notes:'>
        <InputField
          text={props.curation && props.curation.meta.notes || ''}
          placeholder='No Notes'
          onChange={onNotesChange}
          canEdit={canEdit}
          onKeyDown={onInputKeyDown} />
      </CurateBoxRow>
      <CurateBoxRow title='Author Notes:'>
        <InputField
          text={props.curation && props.curation.meta.authorNotes || ''}
          placeholder='No Author Notes'
          onChange={onAuthorNotesChange}
          canEdit={canEdit}
          onKeyDown={onInputKeyDown} />
      </CurateBoxRow>
      {/* Content */}
      <div className='curate-box-files'>
        <div className='curate-box-files__head'>
          {'Content Files: '}
          {(collisionCount !== undefined && collisionCount > 0) ? (
            <label className='curate-box-files__head-collision-count'>
              ({collisionCount} / {contentCollisions && contentCollisions.length} Files or Folders Already Exists)
            </label>
          ) : undefined}
        </div>
        <pre className='curate-box-files__body'>
          {contentFilenames}
        </pre>
      </div>
      {/* Buttons */}
      <div className='curate-box-buttons'>
        <SimpleButton
          className='curate-box-buttons__button'
          value='Remove'
          onClick={onRemoveClick} />
        <SimpleButton
          className='curate-box-buttons__button'
          value='Import'
          onClick={onImportClick} />
      </div>
    </div>
  );
}

/**
 * Create a callback for InputField's onChange.
 * When called, the callback will set the value of a metadata property to the value of the input field.
 * @param property Property the input field should change.
 * @param dispatch Dispatcher to use.
 */
function useOnInputChance(property: keyof IOldCurationMeta, key: string | undefined, dispatch: React.Dispatch<CurationAction>) {
  return useCallback((event: React.ChangeEvent<InputElement>) => {
    if (key !== undefined) {
      dispatch({
        type: 'edit-curation-meta',
        payload: {
          key: key,
          property: property,
          value: event.currentTarget.value
        }
      });
    }
  }, [dispatch]);
}

type ContentCollision = {
  fileName: string;
  fileSize: number;
  fileExists: boolean;
  isFolder: boolean;
}

/**
 * Check all the "collisions" (the files that will be overwritten if the curation is imported)
 * @param content 
 */
async function checkCollisions(content: CurationIndexContent[]) {
  const collisions: ContentCollision[] = [];
  for (let i = 0; i < content.length; i++) {
    const collision: ContentCollision = {
      fileName: GameLauncher.getPathOfHtdocsUrl(content[i].fileName) || '',
      fileSize: 0,
      fileExists: false,
      isFolder: false,
    };
    collisions[i] = collision;
    if (collision.fileName !== undefined) {
      const [stats, error] = await safeAwait(fsStat(collision.fileName));
      if (stats) {
        collision.fileSize = stats.size;
        collision.fileExists = true;
        collision.isFolder = stats.isDirectory();
      }
    }
  }
  return collisions;
}

function safeAwait<T, E = Error>(promise: Promise<T>): Promise<[T,             E | undefined]>;
function safeAwait<T, E = Error>(promise: Promise<T>): Promise<[T | undefined, E            ]>;
/** Await a promise and return the value and error as a tuple (one will always be undefined). */
async function safeAwait<T, E = Error>(promise: Promise<T>): Promise<[T | undefined, E | undefined]> {
  let value: T | undefined = undefined;
  let error: E | undefined = undefined;
  try      { value = await promise; }
  catch(e) { error = e;             }
  return [value, error];
}
