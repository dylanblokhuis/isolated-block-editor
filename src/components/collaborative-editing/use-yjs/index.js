/**
 * External dependencies
 */
import { v4 as uuidv4 } from 'uuid';
import { noop, over, sample } from 'lodash';

/**
 * Internal dependencies
 */
import { createDocument } from './yjs-doc';
import { postDocToObject, updatePostDoc } from './algorithms/yjs';

/**
 * WordPress dependencies
 */
import { useRegistry, useSelect } from '@wordpress/data';
import { useEffect, useRef } from '@wordpress/element';
import { addFilter } from '@wordpress/hooks';

/**
 * Internal dependencies
 */
import { addCollabFilters } from './filters';
import { registerCollabFormats } from './formats';
import { setupUndoManager } from './yjs-undo';

const debug = require( 'debug' )( 'iso-editor:collab' );

/** @typedef {import('..').CollaborationSettings} CollaborationSettings */

export const defaultColors = [ '#4676C0', '#6F6EBE', '#9063B6', '#C3498D', '#9E6D14', '#3B4856', '#4A807A' ];

/**
 * @param {Object} opts
 * @param {import('..').CollaborationSettings} opts.settings
 * @param {Object} opts.registry - Redux data registry for this context.
 */
async function initYDoc( { settings, registry } ) {
	const { channelId, transport } = settings;
	const { dispatch, select } = registry;

	/** @type {string} */
	const identity = uuidv4();

	debug( `initYDoc (identity: ${ identity })` );

	const doc = createDocument( {
		identity,
		applyDataChanges: updatePostDoc,
		getData: postDocToObject,
		/** @param {Object} message */
		sendMessage: ( message ) => {
			debug( 'sendDocMessage', message );
			transport.sendMessage( { type: 'doc', identity, message } );
		},
	} );

	let isUndoManagerReady = false;

	doc.onStateChange( ( newState ) => {
		// Set up undo manager only once per Yjs doc
		if ( newState === 'on' && ! isUndoManagerReady ) {
			setupUndoManager( doc.getPostMap(), identity, registry );
			isUndoManagerReady = true;
		}
	} );

	doc.onRemoteDataChange( ( changes ) => {
		debug( 'remote change received by ydoc', changes );
		dispatch( 'isolated/editor' ).updateBlocksWithUndo( changes.blocks );
	} );

	const { isFirstInChannel } = await transport.connect( {
		user: {
			identity,
			name: settings.username,
			color: settings.caretColor || sample( defaultColors ),
			avatarUrl: settings.avatarUrl,
		},
		/** @param {import('..').CollaborationTransportMessage} data */
		onReceiveMessage: ( data ) => {
			debug( 'remote change received by transport', data );

			switch ( data.type ) {
				case 'doc': {
					doc.receiveMessage( data.message );
					break;
				}
				case 'selection': {
					dispatch( 'isolated/editor' ).setPeerSelection( data.identity, data.selection );
					break;
				}
			}
		},
		setAvailablePeers: ( peers ) => {
			debug( 'setAvailablePeers', peers );
			dispatch( 'isolated/editor' ).setAvailablePeers( peers );
		},
		channelId,
	} );

	debug( `connected (channelId: ${ channelId })` );

	if ( isFirstInChannel ) {
		debug( 'first in channel' );

		// Fetching the blocks from redux now, after the transport has successfully connected,
		// ensures that we don't initialize the Yjs doc with stale blocks.
		// (This can happen if <IsolatedBlockEditor> is given an onLoad handler.)
		doc.startSharing( { title: '', blocks: select( 'core/block-editor' ).getBlocks() } );
	} else {
		doc.connect();
	}

	const applyChangesToYjs = ( blocks ) => {
		if ( doc.getState() !== 'on' ) {
			return;
		}
		debug( 'local changes applied to ydoc' );
		doc.applyDataChanges( { blocks } );
	};

	addFilter( 'isoEditor.blockEditorProvider.onInput', 'isolated-block-editor/collab', ( onInput ) =>
		over( [ onInput, applyChangesToYjs, () => debug( 'BlockEditorProvider onInput' ) ] )
	);
	addFilter( 'isoEditor.blockEditorProvider.onChange', 'isolated-block-editor/collab', ( onChange ) =>
		over( [ onChange, applyChangesToYjs, () => debug( 'BlockEditorProvider onChange' ) ] )
	);

	const disconnect = () => {
		transport.disconnect();
		doc.disconnect();
	};

	window.addEventListener( 'beforeunload', () => disconnect() );

	return {
		sendSelection: ( start, end ) => {
			debug( 'sendSelection', start, end );
			transport.sendMessage( {
				type: 'selection',
				identity,
				selection: {
					start,
					end,
				},
			} );
		},
		undoManager: doc.undoManager,
		disconnect: () => {
			window.removeEventListener( 'beforeunload', disconnect );
			disconnect();
		},
	};
}

/**
 * @param {Object} opts - Hook options
 * @param {CollaborationSettings} [opts.settings]
 */
export default function useYjs( { settings } ) {
	const onSelectionChange = useRef( noop );
	const registry = useRegistry();

	const { selectionStart, selectionEnd } = useSelect( ( select ) => {
		return {
			selectionStart: select( 'core/block-editor' ).getSelectionStart(),
			selectionEnd: select( 'core/block-editor' ).getSelectionEnd(),
		};
	}, [] );

	useEffect( () => {
		if ( ! settings?.enabled ) {
			return;
		}

		if ( ! settings.transport ) {
			// eslint-disable-next-line no-console
			console.error( `Collaborative editor is disabled because a transport module wasn't provided.` );
			return;
		}

		debug( 'registered collab formats' );
		registerCollabFormats();

		debug( 'added collab filters' );
		addCollabFilters();

		let onUnmount = noop;

		initYDoc( {
			settings,
			registry,
		} ).then( ( { sendSelection, disconnect } ) => {
			onUnmount = () => {
				debug( 'unmount' );
				disconnect();
			};

			onSelectionChange.current = sendSelection;
		} );

		return () => onUnmount();
	}, [] );

	useEffect( () => {
		onSelectionChange.current( selectionStart, selectionEnd );
	}, [ selectionStart, selectionEnd ] );
}
