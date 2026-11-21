/**
 * Whether the app is installed, and how to install it where it is not.
 *
 * It matters more here than for most web apps, because nothing a user does
 * leaves their device: the training history *is* the browser's storage. On an
 * iPhone, Safari clears a website's script-written storage after about a week
 * of Safari use in which the site was not opened (WebKit's tracking-prevention
 * rule, since iOS 13.4), and a web app added to the Home Screen is exempt. So a
 * holiday can cost an athlete who trains in a Safari tab everything they have
 * logged — and one Share-sheet tap prevents it.
 *
 * What an installed app cannot be assumed to do is in "Check this phone":
 * home-screen apps before iOS 18.4 refused wake locks, for one.
 */

export type InstallState =
  /** Running as an installed app. */
  | 'installed'
  /** An iPhone or iPad browser tab: installing is a Share-sheet action. */
  | 'ios-tab'
  /** Any other browser tab: installing is in the browser's own menu. */
  | 'browser-tab'

export interface InstallEnvironment {
  /** `(display-mode: standalone)` matches. */
  standaloneDisplay: boolean
  /** Safari's own `navigator.standalone`, where it exists. */
  navigatorStandalone?: boolean
  userAgent: string
  maxTouchPoints: number
}

/** Pure, so every platform's answer can be tested without that platform. */
export function installStateFrom(env: InstallEnvironment): InstallState {
  if (env.standaloneDisplay || env.navigatorStandalone === true) return 'installed'
  // An iPad asks for the desktop site by default and calls itself a Mac; a Mac
  // has no touch points.
  const ios = /iPad|iPhone|iPod/.test(env.userAgent) || (/Macintosh/.test(env.userAgent) && env.maxTouchPoints > 1)
  return ios ? 'ios-tab' : 'browser-tab'
}

export function installState(): InstallState {
  try {
    return installStateFrom({
      standaloneDisplay: window.matchMedia?.('(display-mode: standalone)').matches === true,
      navigatorStandalone: (navigator as Navigator & { standalone?: boolean }).standalone,
      userAgent: navigator.userAgent,
      maxTouchPoints: navigator.maxTouchPoints ?? 0,
    })
  } catch {
    return 'browser-tab'
  }
}

/** What to tell the athlete, per state. Null when there is nothing to do. */
export const INSTALL_STEPS: Record<InstallState, string | null> = {
  installed: null,
  'ios-tab': 'In Safari, tap the Share button, then “Add to Home Screen”.',
  'browser-tab': 'Open your browser’s menu and choose “Install app” or “Add to Home screen”.',
}
