var EventEmitter2 = require('eventemitter2').EventEmitter2,
    // tests is CORS is supported in XHR, if not we need to use XDR
    useXdr = !!(window.XDomainRequest && !('withCredentials' in (new XMLHttpRequest())));

/**
 * Manages the state and loading of a single resource represented by
 * a single URL.
 *
 * @class
 * @param name {string} The name of the resource to load.
 * @param url {string|string[]} The url for this resource, for audio/video loads you can pass an array of sources.
 * @param [options] {object} The options for the load.
 * @param [options.crossOrigin] {boolean} Is this request cross-origin? Default is to determine automatically.
 * @param [options.loadType=Resource.LOAD_TYPE.XHR] {Resource.LOAD_TYPE} How should this resource be loaded?
 * @param [options.xhrType=Resource.XHR_RESPONSE_TYPE.DEFAULT] {Resource.XHR_RESPONSE_TYPE} How should the data being
 *      loaded be interpreted when using XHR?
 */
function Resource(name, url, options) {
    EventEmitter2.call(this);

    options = options || {};

    if (typeof name !== 'string' || typeof url !== 'string') {
        throw new Error('Both name and url are required for constructing a resource.');
    }

    /**
     * The name of this resource.
     *
     * @member {string}
     * @readonly
     */
    this.name = name;

    /**
     * The url used to load this resource.
     *
     * @member {string}
     * @readonly
     */
    this.url = url;

    /**
     * The data that was loaded by the resource.
     *
     * @member {any}
     */
    this.data = null;

    /**
     * Is this request cross-origin? If unset, determined automatically.
     *
     * @member {string}
     */
    this.crossOrigin = options.crossOrigin;

    /**
     * The method of loading to use for this resource.
     *
     * @member {Resource.LOAD_TYPE}
     */
    this.loadType = options.loadType || Resource.LOAD_TYPE.XHR;

    /**
     * The type used to load the resource via XHR. If unset, determined automatically.
     *
     * @member {string}
     */
    this.xhrType = options.xhrType;

    /**
     * The error that occurred while loading (if any).
     *
     * @member {Error}
     * @readonly
     */
    this.error = null;

    /**
     * The XHR object that was used to load this resource. This is only set
     * when `loadType` is `Resource.LOAD_TYPE.XHR`.
     *
     * @member {XMLHttpRequest}
     */
    this.xhr = null;

    /**
     * The `complete` function bound to this resource's context.
     *
     * @member {function}
     * @private
     */
    this._boundComplete = this.complete.bind(this);

    /**
     * The `_onError` function bound to this resource's context.
     *
     * @member {function}
     * @private
     */
    this._boundOnError = this._onError.bind(this);

    /**
     * The `_onProgress` function bound to this resource's context.
     *
     * @member {function}
     * @private
     */
    this._boundOnProgress = this._onProgress.bind(this);

    // xhr callbacks
    this._boundXhrOnError = this._xhrOnError.bind(this);
    this._boundXhrOnAbort = this._xhrOnAbort.bind(this);
    this._boundXhrOnLoad = this._xhrOnLoad.bind(this);
    this._boundXdrOnTimeout = this._xdrOnTimeout.bind(this);

    /**
     * Emitted when the resource beings to load.
     *
     * @event start
     */

    /**
     * Emitted each time progress of this resource load updates.
     * Not all resources types and loader systems can support this event
     * so sometimes it may not be available. If the resource
     * is being loaded on a modern browser, using XHR, and the remote server
     * properly sets Content-Length headers, then this will be available.
     *
     * @event progress
     */

    /**
     * Emitted once this resource has loaded, if there was an error it will
     * be in the `error` property.
     *
     * @event complete
     */
}

Resource.prototype = Object.create(EventEmitter2.prototype);
Resource.prototype.constructor = Resource;
module.exports = Resource;

/**
 * Marks the resource as complete.
 *
 * @fires complete
 */
Resource.prototype.complete = function () {
    // TODO: Clean this up in a wrapper or something...gross....
    if (this.data && this.data.removeEventListener) {
        this.data.removeEventListener('error', this._boundOnError);
        this.data.removeEventListener('load', this._boundComplete);
        this.data.removeEventListener('progress', this._boundOnProgress);
        this.data.removeEventListener('canplaythrough', this._boundComplete);
    }

    if (this.xhr) {
        if (this.xhr.removeEventListener) {
            this.xhr.removeEventListener('error', this._boundXhrOnError);
            this.xhr.removeEventListener('abort', this._boundXhrOnAbort);
            this.xhr.removeEventListener('progress', this._boundOnProgress);
            this.xhr.removeEventListener('load', this._boundXhrOnLoad);
        }
        else {
            this.xhr.onerror = null;
            this.xhr.ontimeout = null;
            this.xhr.onprogress = null;
            this.xhr.onload = null;
        }
    }

    this.emit('complete', this);
};

/**
 * Kicks off loading of this resource.
 *
 * @fires start
 */
Resource.prototype.load = function () {
    this.emit('start', this);

    // if unset, determine the value
    if (typeof this.crossOrigin !== 'string') {
        this.crossOrigin = this._determineCrossOrigin();
    }

    switch(this.loadType) {
        case Resource.LOAD_TYPE.IMAGE:
            this._loadImage();
            break;

        case Resource.LOAD_TYPE.AUDIO:
            this._loadElement('audio');
            break;

        case Resource.LOAD_TYPE.VIDEO:
            this._loadElement('video');
            break;

        case Resource.LOAD_TYPE.XHR:
            /* falls through */
        default:
            if (useXdr) {
                this._loadXdr();
            }
            else {
                this._loadXhr();
            }
            break;
    }
};

/**
 * Loads this resources using an Image object.
 *
 * @private
 */
Resource.prototype._loadImage = function () {
    this.data = new Image();

    if (this.crossOrigin) {
        this.data.crossOrigin = '';
    }

    this.data.src = this.url;

    this.data.addEventListener('error', this._boundOnError, false);
    this.data.addEventListener('load', this._boundComplete, false);
    this.data.addEventListener('progress', this._boundOnProgress, false);
};

/**
 * Loads this resources using an HTMLAudioElement or HTMLVideoElement.
 *
 * @private
 */
Resource.prototype._loadElement = function (type) {
    this.data = document.createElement(type);

    if (Array.isArray(this.url)) {
        for (var i = 0; i < this.url.length; ++i) {
            this.data.appendChild(this._createSource(type, this.url[i]));
        }
    }
    else {
        this.data.appendChild(this._createSource(type, this.url));
    }

    this.data.addEventListener('error', this._boundOnError, false);
    this.data.addEventListener('load', this._boundComplete, false);
    this.data.addEventListener('progress', this._boundOnProgress, false);
    this.data.addEventListener('canplaythrough', this._boundComplete, false);

    this.data.load();
};

/**
 * Loads this resources using an XMLHttpRequest.
 *
 * @private
 */
Resource.prototype._loadXhr = function () {
    // if unset, determine the value
    if (typeof this.xhrType !== 'string') {
        this.xhrType = this._determineXhrType();
    }

    var xhr = this.xhr = new XMLHttpRequest();

    // set the responseType
    xhr.responseType = this.xhrType;

    xhr.addEventListener('error', this._boundXhrOnError, false);
    xhr.addEventListener('abort', this._boundXhrOnAbort, false);
    xhr.addEventListener('progress', this._boundOnProgress, false);
    xhr.addEventListener('load', this._boundXhrOnLoad, false);

    xhr.open('GET', this.url, true);
    xhr.send();
};

/**
 * Loads this resources using an XDomainRequest. This is here because we need to support IE9 (gross).
 *
 * @private
 */
Resource.prototype._loadXdr = function () {
    var xdr = this.xhr = new XDomainRequest();

    // XDomainRequest has a few quirks. Occasionally it will abort requests
    // A way to avoid this is to make sure ALL callbacks are set even if not used
    // More info here: http://stackoverflow.com/questions/15786966/xdomainrequest-aborts-post-on-ie-9
    xdr.timeout = 5000;

    xdr.onerror = this._boundXhrOnError;
    xdr.ontimeout = this._boundXdrOnTimeout;
    xdr.onprogress = this._boundOnProgress;
    xdr.onload = this._boundXhrOnLoad;
};

/**
 * Creates a source used in loading via an element.
 *
 * @param type {string} The element type (video or audio).
 * @param url {string} The source URL to load from.
 * @param [mime] {string} The mime type of the video
 * @private
 */
Resource.prototype._createSource = function (type, url, mime) {
    if (!mime) {
        mime = type + '/' + url.substr(url.lastIndexOf('.') + 1);
    }

    var source = document.createElement('source');

    source.src = url;
    source.type = mime;

    return source;
};

/**
 * Called if a load errors out.
 *
 * @param error {Error} The error that happened.
 * @private
 */
Resource.prototype._onError = function (event) {
    this.error = new Error('Failed to load element using ' + event.target.nodeName);
    this.complete();
};

/**
 * Called if a load progress event fires for xhr/xdr.
 *
 * @fires progress
 * @param event {XMLHttpRequestProgressEvent|Event}
 * @private
 */
Resource.prototype._onProgress =  function (event) {
    if (event.lengthComputable) {
        this.emit('progress', this, event.loaded / event.total);
    }
};

/**
 * Called if an error event fires for xhr/xdr.
 *
 * @param event {XMLHttpRequestErrorEvent|Event}
 * @private
 */
Resource.prototype._xhrOnError = function (event) {
    this.error = new Error(
        reqType(event.target) + ' Request failed. ' +
        'Status: ' + event.target.status + ', text: "' + event.target.statusText + '"'
    );

    this.complete();
};

/**
 * Called if an abort event fires for xhr.
 *
 * @param event {XMLHttpRequestAbortEvent}
 * @private
 */
Resource.prototype._xhrOnAbort = function (event) {
    this.error = new Error(reqType(event.target) + ' Request was aborted by the user.');
    this.complete();
};

/**
 * Called if a timeout event fires for xdr.
 *
 * @param event {Event}
 * @private
 */
Resource.prototype._xdrOnTimeout = function (event) {
    this.error = new Error(reqType(event.target) + ' Request timed out.');
    this.complete();
};

/**
 * Called when data successfully loads from an xhr/xdr request.
 *
 * @param event {XMLHttpRequestLoadEvent|Event}
 * @private
 */
Resource.prototype._xhrOnLoad = function (event) {
    var xhr = event.target;

    if (xhr.status === 200) {
        if (this.xhrType === Resource.XHR_RESPONSE_TYPE.TEXT) {
            this.data = xhr.responseText;
        }
        else if (this.xhrType === Resource.XHR_RESPONSE_TYPE.DOCUMENT) {
            this.data = xhr.responseXML || xhr.response;
        }
        else {
            this.data = xhr.response;
        }
    }
    else {
        this.error = new Error(xhr.responseText);
    }

    this.complete();
};

function reqType(xhr) {
    return xhr.toString().replace('object ', '');
}

/**
 * Sets the `crossOrigin` property for this resource based on if the url
 * for this resource is cross-origin. If crossOrigin was manually set, this
 * function does nothing.
 *
 * @private
 * @return {string} The crossOrigin value to use (or empty string for none).
 */
Resource.prototype._determineCrossOrigin = function () {
    // data: and javascript: urls are considered same-origin
    if (this.url.indexOf('data:') === 0) {
        return '';
    }

    // check if this is a cross-origin url
    var loc = window.location,
        a = document.createElement('a');

    a.href = this.url;

    // if cross origin
    if (a.hostname !== loc.hostname || a.port !== loc.port || a.protocol !== loc.protocol) {
        return 'anonymous';
    }

    return '';
};

/**
 * Determines the responseType of an XHR request based on the extension of the
 * resource being loaded.
 *
 * @private
 * @return {Resource.XHR_RESPONSE_TYPE} The responseType to use.
 */
Resource.prototype._determineXhrType = function () {
    var ext = this.url.substr(this.url.lastIndexOf('.') + 1);

    switch(ext) {
        // xml
        case 'xhtml':
        case 'html':
        case 'htm':
        case 'xml':
        case 'tmx':
        case 'tsx':
        case 'svg':
            return Resource.XHR_RESPONSE_TYPE.DOCUMENT;

        // images
        case 'gif':
        case 'png':
        case 'jpg':
        case 'jpeg':
        case 'tif':
        case 'tiff':
        case 'webp':
            return Resource.XHR_RESPONSE_TYPE.BLOB;

        // json
        case 'json':
            return Resource.XHR_RESPONSE_TYPE.JSON;

        // text
        case 'text':
        case 'txt':
            /* falls through */
        default:
            return Resource.XHR_RESPONSE_TYPE.TEXT;
    }
};

/**
 * Determines the mime type of an XHR request based on the responseType of
 * resource being loaded.
 *
 * @private
 * @return {string} The mime type to use.
 */
Resource.prototype._getMimeFromXhrType = function (type) {
    switch(type) {
        case Resource.XHR_RESPONSE_TYPE.BUFFER:
            return 'application/octet-binary';

        case Resource.XHR_RESPONSE_TYPE.BLOB:
            return 'application/blob';

        case Resource.XHR_RESPONSE_TYPE.DOCUMENT:
            return 'application/xml';

        case Resource.XHR_RESPONSE_TYPE.JSON:
            return 'application/json';

        case Resource.XHR_RESPONSE_TYPE.DEFAULT:
        case Resource.XHR_RESPONSE_TYPE.TEXT:
            /* falls through */
        default:
            return 'text/plain';

    }
};

/**
 * The types of loading a resource can use.
 *
 * @static
 * @constant
 * @property {object} LOAD_TYPE
 * @property {number} LOAD_TYPE.XHR - Uses XMLHttpRequest to load the resource.
 * @property {number} LOAD_TYPE.IMAGE - Uses an `Image` object to load the resource.
 * @property {number} LOAD_TYPE.AUDIO - Uses an `Audio` object to load the resource.
 * @property {number} LOAD_TYPE.VIDEO - Uses a `Video` object to load the resource.
 */
Resource.LOAD_TYPE = {
    XHR:    1,
    IMAGE:  2,
    AUDIO:  3,
    VIDEO:  4
};

/**
 * The XHR ready states, used internally.
 *
 * @static
 * @constant
 * @property {object} XHR_READY_STATE
 * @property {number} XHR_READY_STATE.UNSENT - open()has not been called yet.
 * @property {number} XHR_READY_STATE.OPENED - send()has not been called yet.
 * @property {number} XHR_READY_STATE.HEADERS_RECEIVED - send() has been called, and headers and status are available.
 * @property {number} XHR_READY_STATE.LOADING - Downloading; responseText holds partial data.
 * @property {number} XHR_READY_STATE.DONE - The operation is complete.
 */
Resource.XHR_READY_STATE = {
    UNSENT: 0,
    OPENED: 1,
    HEADERS_RECEIVED: 2,
    LOADING: 3,
    DONE: 4
};

/**
 * The XHR ready states, used internally.
 *
 * @static
 * @constant
 * @property {object} XHR_RESPONSE_TYPE
 * @property {string} XHR_RESPONSE_TYPE.DEFAULT - defaults to text
 * @property {string} XHR_RESPONSE_TYPE.BUFFER - ArrayBuffer
 * @property {string} XHR_RESPONSE_TYPE.BLOB - Blob
 * @property {string} XHR_RESPONSE_TYPE.DOCUMENT - Document
 * @property {string} XHR_RESPONSE_TYPE.JSON - Object
 * @property {string} XHR_RESPONSE_TYPE.TEXT - String
 */
Resource.XHR_RESPONSE_TYPE = {
    DEFAULT:    'text',
    BUFFER:     'arraybuffer',
    BLOB:       'blob',
    DOCUMENT:   'document',
    JSON:       'json',
    TEXT:       'text'
};
