// @ts-nocheck TODO

/**
 * External dependencies
 */
import * as yjs from 'yjs';
import { isEqual } from 'lodash';

/**
 * Internal dependencies
 */
import * as diff from './diff';

/**
 * Updates the block doc with the local blocks block changes.
 *
 * @param {yjs.Map} yDocBlocks Blocks doc.
 * @param {Array}   blocks     Updated blocks.
 * @param {string}  clientId   Current clientId.
 */
export function updateBlocksDoc( yDocBlocks, blocks, clientId = '' ) {
	if ( ! yDocBlocks.has( 'order' ) ) {
		yDocBlocks.set( 'order', new yjs.Map() );
	}
	let order = yDocBlocks.get( 'order' );
	if ( ! order.has( clientId ) ) order.set( clientId, new yjs.Array() );
	order = order.get( clientId );
	if ( ! yDocBlocks.has( 'byClientId' ) ) {
		yDocBlocks.set( 'byClientId', new yjs.Map() );
	}
	const byClientId = yDocBlocks.get( 'byClientId' );
	const currentOrder = order.toArray();
	const orderDiff = diff.simpleDiffArray(
		currentOrder,
		blocks.map( ( block ) => block.clientId )
	);
	currentOrder
		.slice( orderDiff.index, orderDiff.remove )
		.forEach( ( _clientId ) => ! orderDiff.insert.includes( _clientId ) && byClientId.delete( _clientId ) );
	order.delete( orderDiff.index, orderDiff.remove );
	order.insert( orderDiff.index, orderDiff.insert );

	for ( const _block of blocks ) {
		const { innerBlocks, ...block } = _block;
		if ( ! byClientId.has( block.clientId ) || ! isEqual( byClientId.get( block.clientId ), block ) ) {
			byClientId.set( block.clientId, block );
		}

		updateBlocksDoc( yDocBlocks, innerBlocks, block.clientId );
	}
}

/**
 * Updates the comments doc with the local comments changes.
 *
 * @param {yjs.Doc} commentsDoc  comments doc.
 * @param {Object}  comments     Updated comments.
 */
export function updateCommentsDoc( commentsDoc, comments = [] ) {
	comments.forEach( ( comment ) => {
		let currentDoc = commentsDoc.get( comment._id );
		const isNewDoc = ! currentDoc;
		if ( ! currentDoc ) {
			commentsDoc.set( comment._id, new yjs.Map() );
		}
		currentDoc = commentsDoc.get( comment._id );
		// Update regular fields
		[ 'type', 'content', 'createdAt', 'status', 'start', 'end', 'authorId', 'authorName' ].forEach( ( field ) => {
			if ( isNewDoc || currentDoc.get( field ) !== comment[ field ] ) {
				currentDoc.set( field, comment[ field ] );
			}
		} );

		if ( isNewDoc ) {
			currentDoc.set( 'replies', new yjs.Map() );
		}

		updateCommentRepliesDoc( currentDoc.get( 'replies' ), comment.replies );
	} );
}

/**
 * Updates the replies doc with the local replies changes.
 *
 * @param {yjs.Doc} repliesDoc  replies doc.
 * @param {Object}  replies     Updated replies.
 */
export function updateCommentRepliesDoc( repliesDoc, replies = [] ) {
	replies.forEach( ( reply ) => {
		let currentReplyDoc = repliesDoc.get( reply._id );
		const isNewDoc = ! currentReplyDoc;
		if ( ! currentReplyDoc ) {
			repliesDoc.set( reply._id, new yjs.Map() );
		}
		currentReplyDoc = repliesDoc.get( reply._id );
		[ 'content', 'createdAt', 'authorId', 'authorName' ].forEach( ( field ) => {
			if ( isNewDoc || currentReplyDoc.get( field ) !== reply[ field ] ) {
				currentReplyDoc.set( field, reply[ field ] );
			}
		} );
	} );
}

/**
 * Updates the post doc with the local post changes.
 *
 * @param {yjs.Doc} doc     Shared doc.
 * @param {Object}  newPost Updated post.
 */
export function updatePostDoc( doc, newPost ) {
	const postDoc = doc.get( 'post', yjs.Map );
	if ( postDoc.get( 'title' ) !== newPost.title ) {
		postDoc.set( 'title', newPost.title );
	}
	if ( ! postDoc.get( 'blocks', yjs.Map ) ) {
		postDoc.set( 'blocks', new yjs.Map() );
	}
	updateBlocksDoc( postDoc.get( 'blocks' ), newPost.blocks || [] );
	if ( ! postDoc.get( 'comments', yjs.Map ) ) {
		postDoc.set( 'comments', new yjs.Map() );
	}
	updateCommentsDoc( postDoc.get( 'comments' ), newPost.comments );
}

/**
 * Converts the comments doc into a comment list.
 *
 * @param {yjs.Map} commentsDoc Comments doc.
 * @return {Array} Comment list.
 */
export function commentsDocToArray( commentsDoc ) {
	if ( ! commentsDoc ) {
		return [];
	}

	return Object.entries( commentsDoc.toJSON() ).map( ( [ id, commentDoc ] ) => {
		return {
			_id: id,
			type: commentDoc.type,
			content: commentDoc.content,
			createdAt: commentDoc.createdAt,
			status: commentDoc.status,
			start: commentDoc.start,
			end: commentDoc.end,
			authorId: commentDoc.authorId,
			authorName: commentDoc.authorName,
			replies: Object.entries( commentDoc.replies )
				.map( ( [ replyId, entryDoc ] ) => {
					return {
						_id: replyId,
						content: entryDoc.content,
						createdAt: entryDoc.createdAt,
						authorId: entryDoc.authorId,
						authorName: entryDoc.authorName,
					};
				} )
				.sort( ( a, b ) => a.createdAt - b.createdAt ),
		};
	} );
}

/**
 * Converts the block doc into a block list.
 *
 * @param {yjs.Map} yDocBlocks Block doc.
 * @param {string}  clientId   Current block clientId.
 * @return {Array} Block list.
 */
export function blocksDocToArray( yDocBlocks, clientId = '' ) {
	if ( ! yDocBlocks ) {
		return [];
	}
	let order = yDocBlocks.get( 'order' );
	order = order.get( clientId )?.toArray();
	if ( ! order ) return [];
	const byClientId = yDocBlocks.get( 'byClientId' );

	return order.map( ( _clientId ) => ( {
		...byClientId.get( _clientId ),
		innerBlocks: blocksDocToArray( yDocBlocks, _clientId ),
	} ) );
}

/**
 * Converts the post doc into a post object.
 *
 * @param {yjs.Map} doc Shared doc.
 * @return {Object} Post object.
 */
export function postDocToObject( doc ) {
	const postDoc = doc.get( 'post', yjs.Map );
	const blocks = blocksDocToArray( postDoc.get( 'blocks' ) );
	const comments = commentsDocToArray( postDoc.get( 'comments' ) );

	return {
		title: postDoc.get( 'title' ) || '',
		blocks,
		comments,
	};
}
