import { describe, expect, it } from 'vitest'
import { INSTALL_STEPS, installStateFrom, type InstallEnvironment } from './install'

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1'
const IPAD_AS_DESKTOP =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15'
const ANDROID =
  'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36'
const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

const env = (patch: Partial<InstallEnvironment>): InstallEnvironment => ({
  standaloneDisplay: false,
  userAgent: WINDOWS,
  maxTouchPoints: 0,
  ...patch,
})

describe('whether the app is installed', () => {
  it('knows an iPhone tab from an iPhone Home Screen app', () => {
    expect(installStateFrom(env({ userAgent: IPHONE, maxTouchPoints: 5 }))).toBe('ios-tab')
    // Safari's own flag, on versions where the display-mode query says nothing.
    expect(installStateFrom(env({ userAgent: IPHONE, maxTouchPoints: 5, navigatorStandalone: true }))).toBe('installed')
    expect(installStateFrom(env({ userAgent: IPHONE, maxTouchPoints: 5, standaloneDisplay: true }))).toBe('installed')
    // `navigator.standalone === false` is Safari saying "a tab", not "unknown".
    expect(installStateFrom(env({ userAgent: IPHONE, maxTouchPoints: 5, navigatorStandalone: false }))).toBe('ios-tab')
  })

  it('recognises an iPad that calls itself a Mac, and does not mistake a Mac for one', () => {
    expect(installStateFrom(env({ userAgent: IPAD_AS_DESKTOP, maxTouchPoints: 5 }))).toBe('ios-tab')
    expect(installStateFrom(env({ userAgent: IPAD_AS_DESKTOP, maxTouchPoints: 0 }))).toBe('browser-tab')
  })

  it('treats every other browser tab as one, and any standalone window as installed', () => {
    expect(installStateFrom(env({ userAgent: ANDROID, maxTouchPoints: 5 }))).toBe('browser-tab')
    expect(installStateFrom(env({ userAgent: WINDOWS }))).toBe('browser-tab')
    expect(installStateFrom(env({ userAgent: ANDROID, maxTouchPoints: 5, standaloneDisplay: true }))).toBe('installed')
    expect(installStateFrom(env({ userAgent: WINDOWS, standaloneDisplay: true }))).toBe('installed')
  })

  it('has steps for every state that needs them, and none for an installed app', () => {
    expect(INSTALL_STEPS.installed).toBeNull()
    expect(INSTALL_STEPS['ios-tab']).toMatch(/Share/)
    expect(INSTALL_STEPS['ios-tab']).toMatch(/Add to Home Screen/)
    expect(INSTALL_STEPS['browser-tab']).toMatch(/menu/)
  })
})
