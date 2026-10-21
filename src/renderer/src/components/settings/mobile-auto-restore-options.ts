import { translate } from '@/i18n/i18n'

export const AUTO_RESTORE_FIT_OPTIONS: { value: string; label: string; ms: number | null }[] = [
  {
    value: 'indefinite',
    get label() {
      return translate(
        'auto.components.settings.MobilePane.aa1263e881',
        'Keep at phone size (default)'
      )
    },
    ms: null
  },
  {
    value: 'on-leave',
    get label() {
      return translate(
        'auto.components.settings.MobilePane.3b9e1d7c52',
        'As soon as you leave the terminal'
      )
    },
    // Why: matches the host's 1s floor, which absorbs the phone's own quick resubscribes.
    ms: 1_000
  },
  {
    value: '60s',
    get label() {
      return translate('auto.components.settings.MobilePane.c474aa09d8', 'After 1 minute')
    },
    ms: 60_000
  },
  {
    value: '5m',
    get label() {
      return translate('auto.components.settings.MobilePane.d4ba07d914', 'After 5 minutes')
    },
    ms: 5 * 60_000
  },
  {
    value: '30m',
    get label() {
      return translate('auto.components.settings.MobilePane.ff865419dc', 'After 30 minutes')
    },
    ms: 30 * 60_000
  }
]

export function autoRestoreValueFromMs(ms: number | null | undefined): string {
  if (ms == null) {
    return 'indefinite'
  }
  const exact = AUTO_RESTORE_FIT_OPTIONS.find((o) => o.ms === ms)
  return exact ? exact.value : 'indefinite'
}
