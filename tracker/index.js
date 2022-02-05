// import { doNotTrack, hook } from '../lib/web';
// import { removeTrailingSlash } from '../lib/url';

export const hook = (_this, method, callback) => {
  const orig = _this[method];

  return (...args) => {
    callback.apply(null, args);

    return orig.apply(_this, args);
  };
};

export const doNotTrack = () => {
  const { doNotTrack, navigator, external } = window;

  const msTrackProtection = 'msTrackingProtectionEnabled';
  const msTracking = () => {
    return external && msTrackProtection in external && external[msTrackProtection]();
  };

  const dnt = doNotTrack || navigator.doNotTrack || navigator.msDoNotTrack || msTracking();

  return dnt == '1' || dnt === 'yes';
};

export function removeTrailingSlash(url) {
  return url && url.length > 1 && url.endsWith('/') ? url.slice(0, -1) : url;
}

(window => {
  const {
    screen: { width, height },
    navigator: { language },
    location: { hostname, pathname, search },
    localStorage,
    sessionStorage,
    document,
    history,
  } = window;

  // version: test1

  const script = document.querySelector('script[data-website-id]');

  if (!script) return;

  const attr = script.getAttribute.bind(script);
  // follow this for the JPMM script? No UMD support
  const website = attr('data-website-id');
  const hostUrl = attr('data-host-url');
  const autoTrack = attr('data-auto-track') !== 'false';
  const dnt = attr('data-do-not-track');
  const useCache = attr('data-cache');
  const domain = attr('data-domains') || '';
  const domains = domain.split(',').map(n => n.trim());
  // event info
  const eventClass = /^umami--([a-z]+)--([\w]+[\w-]*)$/;
  const eventSelect = "[class*='umami--']";
  const cacheKey = 'umami.cache';

  const disableTracking = () =>
    (localStorage && localStorage.getItem('umami.disabled')) ||
    (dnt && doNotTrack()) ||
    (domain && !domains.includes(hostname));

  const root = hostUrl
    ? removeTrailingSlash(hostUrl)
    : script.src.split('/').slice(0, -1).join('/');
  const screen = `${width}x${height}`;
  // event listeners
  const listeners = {};
  let currentUrl = `${pathname}${search}`;
  let currentRef = document.referrer;

  /* Collect metrics */

  const post = (url, data, callback) => {
    const req = new XMLHttpRequest();
    req.open('POST', url, true);
    req.setRequestHeader('Content-Type', 'application/json');

    req.onreadystatechange = () => {
      if (req.readyState === 4) {
        callback(req.response);
      }
    };
    console.log('click on a configured element', JSON.stringify(data));
    /* {
    "type":"event",
    "payload":{
      "website":"76b1e8bc-3303-44f0-885f-c65d5f7f5789",
      "hostname":"localhost",
      "screen":"1728x1117",
      "language":"en-US",
      "cache":null,
      "event_type":"custom",
      "event_value":"link click",
      "url":"/"}
    } */
    req.send(JSON.stringify(data));
  };

  const collect = (type, params, uuid) => {
    if (disableTracking()) return;

    const payload = {
      website: uuid,
      hostname,
      screen,
      language,
      cache: useCache && sessionStorage.getItem(cacheKey),
    };

    Object.keys(params).forEach(key => {
      payload[key] = params[key];
    });

    post(
      `${root}/api/collect`,
      {
        type,
        payload,
      },
      res => useCache && sessionStorage.setItem(cacheKey, res),
    );
  };

  const trackView = (url = currentUrl, referrer = currentRef, uuid = website) => {
    collect(
      'pageview',
      {
        url,
        referrer,
      },
      uuid,
    );
  };

  // Events - defaults to custom
  const trackEvent = (event_value, event_type = 'custom', url = currentUrl, uuid = website) => {
    collect(
      'event',
      {
        event_type,
        event_value,
        url,
      },
      uuid,
    );
  };

  /* Handle events */

  const addEvent = element => {
    element.className.split(' ').forEach(className => {
      if (!eventClass.test(className)) return;

      const [, type, value] = className.split('--');
      const listener = listeners[className]
        ? listeners[className]
        : (listeners[className] = () => trackEvent(value, type));

      element.addEventListener(type, listener, true);
    });
  };

  const monitorMutate = mutations => {
    mutations.forEach(mutation => {
      const element = mutation.target;
      addEvent(element);
      element.querySelectorAll(eventSelect).forEach(addEvent);
    });
  };

  /* Handle history changes */

  const handlePush = (state, title, url) => {
    if (!url) return;

    currentRef = currentUrl;
    const newUrl = url.toString();

    if (newUrl.substring(0, 4) === 'http') {
      currentUrl = '/' + newUrl.split('/').splice(3).join('/');
    } else {
      currentUrl = newUrl;
    }

    if (currentUrl !== currentRef) {
      trackView();
    }
  };

  /* Global */

  if (!window.umami) {
    const umami = eventValue => trackEvent(eventValue);
    umami.trackView = trackView;
    umami.trackEvent = trackEvent;

    window.umami = umami;
  }

  /* Start */

  if (autoTrack && !disableTracking()) {
    history.pushState = hook(history, 'pushState', handlePush);
    history.replaceState = hook(history, 'replaceState', handlePush);

    const update = () => {
      switch (document.readyState) {
        /* DOM rendered, add event listeners */
        case 'interactive': {
          document.querySelectorAll(eventSelect).forEach(addEvent);
          const observer = new MutationObserver(monitorMutate);
          observer.observe(document, { childList: true, subtree: true });
          break;
        }
        /* Page loaded, track our view */
        case 'complete':
          trackView();
          break;
      }
    };
    document.addEventListener('readystatechange', update, true);
    update();
  }
})(window);
