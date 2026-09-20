# Mainnet mint account fixtures

Raw Token-2022 mint account data captured with one confirmed `getMultipleAccounts` call against Solana mainnet at slot **448,479,437** on 2026-09-20 (Asia/Jakarta).

These tiny immutable test vectors let the Rust program parse the exact extension layout observed in production without requiring RPC access during CI. They are not private keys and contain only public account data.

| File               | Mint                                          | Bytes | SHA-256                                                            |
| ------------------ | --------------------------------------------- | ----: | ------------------------------------------------------------------ |
| `anduril.mint.bin` | `PresTj4Yc2bAR197Er7wz4UUKSfqt6FryBEdAriBoQB` |   905 | `4335cbc177c4391b2580877ea1c042c7089754d41b786635e030165059da8164` |
| `openai.mint.bin`  | `PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF` |   902 | `7438a74412ae9ad6da62e015fad4faab469a16cda25ed3f6d1a5a0853bddf934` |
| `spacex.mint.bin`  | `PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh` |   902 | `d7b26ce9a6f2d7ac86e4438f01f83068290be5d99857b24e085cc1769ae90dad` |

Re-capture these only after reviewing the diff in parsed authorities, fees, hook state, pause state, and multipliers.
