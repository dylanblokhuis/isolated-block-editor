/**
 * External dependencies
 */
import * as yjs from 'yjs';

const debugUndo = require( 'debug' )( 'iso-editor:collab:undo' );

/** @typedef {import('./algorithms/yjs').PostObject} PostObject */
/** @typedef {import('..').EditorSelection} EditorSelection */

const encodeArray = ( array ) => array.toString();
const decodeArray = ( string ) => new Uint8Array( string.split( ',' ) );

/**
 * Create a Yjs document.
 *
 * @param {Object} opts
 * @param {string} opts.identity - Client identifier.
 * @param {function(yjs.Doc, PostObject): void} opts.applyDataChanges - Function to apply changes to the Yjs doc.
 * @param {function(yjs.Doc): PostObject} opts.getData - Function to get post object data from the Yjs doc.
 * @param {function(): EditorSelection} opts.getSelection
 * @param {function(EditorSelection): void} opts.setSelection
 * @param {function(any): void} opts.sendMessage
 */
export function createDocument( { identity, applyDataChanges, getData, getSelection, setSelection, sendMessage } ) {
	const doc = new yjs.Doc();
	let state = 'off';

	/** @type {yjs.UndoManager | undefined} */
	let undoManager;

	const setupUndoManagerOnReady = ( newState ) => {
		if ( newState === 'on' && ! undoManager ) {
			const postMap = doc.getMap( 'post' );
			undoManager = new yjs.UndoManager( postMap, { trackedOrigins: new Set( [ identity ] ) } );

			undoManager.on( 'stack-item-added', ( event ) => {
				const selection = getSelection();
				event.stackItem.meta.set( 'caret-location', selection );
				debugUndo( 'undo stack item added with selection', selection );
			} );
			undoManager.on( 'stack-item-popped', ( event ) => {
				const selectionReferenceItem =
					event.type === 'undo' ? undoManager?.undoStack.at( -1 ) : event.stackItem;
				const selection = selectionReferenceItem?.meta.get( 'caret-location' );
				if ( selection?.start ) {
					setSelection( selection );
				}
				debugUndo( 'stack item popped with selection', selection );
			} );

			debugUndo( 'instantiated UndoManager' );
		}
	};

	let listeners = [];
	let stateListeners = [ setupUndoManagerOnReady ];

	doc.on( 'update', ( update, origin ) => {
		const isLocalOrigin = origin === identity || origin instanceof yjs.UndoManager;

		if ( isLocalOrigin && state === 'on' ) {
			sendMessage( {
				protocol: 'yjs1',
				messageType: 'syncUpdate',
				update: encodeArray( update ),
			} );
		}

		if ( origin !== identity ) {
			const newData = getData( doc );
			listeners.forEach( ( listener ) => listener( newData ) );
		}
	} );

	const setState = ( newState ) => {
		state = newState;
		stateListeners.forEach( ( listener ) => listener( newState ) );
	};

	const sync = ( destination, isReply ) => {
		const stateVector = yjs.encodeStateVector( doc );
		sendMessage( {
			protocol: 'yjs1',
			messageType: 'sync1',
			stateVector: encodeArray( stateVector ),
			origin: identity,
			destination,
			isReply,
		} );
	};

	return {
		applyDataChanges( data ) {
			if ( state !== 'on' ) {
				throw 'wrong state';
			}
			doc.transact( () => {
				applyDataChanges( doc, data );
			}, identity );
		},

		connect() {
			if ( state === 'on' ) {
				throw 'wrong state';
			}

			setState( 'connecting' );
			sync();
		},

		disconnect() {
			setState( 'off' );
		},

		startSharing( data ) {
			if ( state === 'on' ) {
				throw 'wrong state';
			}

			setState( 'on' );
			this.applyDataChanges( data );
		},

		receiveMessage( { protocol, messageType, origin, ...content } ) {
			if ( protocol !== 'yjs1' ) {
				throw 'wrong protocol';
			}

			switch ( messageType ) {
				case 'sync1':
					if ( content.destination && content.destination !== identity ) {
						return;
					}
					sendMessage( {
						protocol: 'yjs1',
						messageType: 'sync2',
						update: encodeArray( yjs.encodeStateAsUpdate( doc, decodeArray( content.stateVector ) ) ),
						destination: origin,
					} );
					if ( ! content.isReply ) {
						sync( origin, true );
					}
					break;
				case 'sync2':
					if ( content.destination !== identity ) {
						return;
					}
					yjs.applyUpdate( doc, decodeArray( content.update ), origin );
					setState( 'on' );
					break;
				case 'syncUpdate':
					yjs.applyUpdate( doc, decodeArray( content.update ), origin );
					break;
			}
		},

		onRemoteDataChange( listener ) {
			listeners.push( listener );

			return () => {
				listeners = listeners.filter( ( l ) => l !== listener );
			};
		},

		onStateChange( listener ) {
			stateListeners.push( listener );

			return () => {
				stateListeners = stateListeners.filter( ( l ) => l !== listener );
			};
		},

		getState() {
			return state;
		},

		undoManager: {
			hasUndo() {
				return ( undoManager?.undoStack.length ?? 0 ) > 1;
			},
			hasRedo() {
				return !! undoManager?.redoStack.length;
			},
			undo() {
				debugUndo( 'undo' );
				undoManager?.undo();
			},
			redo() {
				debugUndo( 'redo' );
				undoManager?.redo();
			},
		},
	};
}
