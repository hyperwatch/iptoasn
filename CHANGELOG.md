# Changelog

Code changes only. The daily releases of a new table (`MAJOR.MINOR.YYYYMMDD`, see the README) are on [GitHub](https://github.com/hyperwatch/iptoasn/releases).

## 1.0

First release: lookups of the AS of IPv4 and IPv6 addresses (`load()`, `loadSync()`, `lookup()`, `find()` and `range()`).

From 1.0.20261118, the table ships ready to use: the lookup arrays as they are in memory, and the names as UTF-8 bytes (format `hyperwatch-iptoasn 2`, `data/iptoasn.bin.br`, 3.7 MB). Loading takes about 70 ms instead of 0.5 s, keeps 14 MB outside the JavaScript heap instead of 38 MB, and makes no garbage (125 MB before, which raised the process's memory by 270 MB). `encode()` gives a `Buffer` and `decode()` takes one, tables have no `labels` array, and `parse()` merges contiguous ranges of the same AS. Lookups don't change.
