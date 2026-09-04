# dsh-plugins

Local source of record for every DeepSeek Harness plugin this machine actually runs.

- **Owned plugins** (`dsh-cost-meter`, `dsh-memory`) live in this repo and are pushed here.
- **Third-party plugins** are Git submodules. `origin` is the Poeagle fork; each clone also has an `upstream` remote pointing at the original GitHub repo. Pin the submodule SHA to the version currently linked into `~/.dsh/profiles/web`.

Web profile links:

| Package | Source |
| --- | --- |
| `dsh-cost-meter` | this repo |
| `dsh-memory` | this repo |
| `dsh-prompt-enhancer` | submodule → [Poeagle/dsh-prompt-enhancer](https://github.com/Poeagle/dsh-prompt-enhancer) (`upstream`: Fishsb) |
| `@xmanrui/dsh-im` | submodule → [Poeagle/dsh-im](https://github.com/Poeagle/dsh-im) (`upstream`: xmanrui), currently `v4.11.0` |
| `@linxin666/dsh-web-all` | submodule → [Poeagle/dsh-web](https://github.com/Poeagle/dsh-web) (`upstream`: zhu1090093659), currently `v0.3.14` |
| `dshmarket` | submodule → [Poeagle/dsh-market](https://github.com/Poeagle/dsh-market) (`upstream`: dsh-market), currently `v1.42.0` |

Unused clones kept as submodules: `archify`, `open-design`.
