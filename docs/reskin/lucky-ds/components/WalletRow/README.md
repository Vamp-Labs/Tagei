# WalletRow

One currency wallet in the Wallets list: a currency disc, the amount with its code, an optional bonus line, and a radio in the corner. The selected row gets a green wash and a filled check.

- Provide: `icon` (currency disc url), `amount` (string, keep the source's precision), `currency` (USD, EUR, BTC…), `bonus` (e.g. "dp.bonus + 280 USD"), `bonusTone` (`lucky` for the primary wallet, `info` otherwise), `selected`, `onSelect`.
- Rows stack with `space-2` gaps in a Panel titled Wallets; end the list with a secondary Add new button.
