# NOTICE — the three disk images

**This is a NOTICE, not a licence.** It records what could be established about these images
from the bytes themselves and from their upstream, and it is explicit about what could not.
Where a component's terms are known, they are stated; where they are not, they are marked
UNRESOLVED rather than guessed. Anyone relying on this for a licensing decision should read the
UNRESOLVED section first.

## Where all three came from

`freedos722.img`, `linux.iso` and `openbsd.img` are byte-identical to the files of the same
names in <https://github.com/copy/images> — the image set `copy/v86`'s own examples load. The
match was made on Git blob SHA-1 (`git hash-object`) against the `sha` GitHub reports for those
paths, so it is exact and not a size coincidence. That repository's `Readme.md` names the
original sources: FreeDOS from <https://www.freedos.org/>, the Linux image built with Buildroot
(<https://buildroot.org/>), and OpenBSD from <https://www.openbsd.org/>. None of the three has
been modified here.

## `linux.iso` — 5,666,816 bytes, booted by `/labs/linux`

A Buildroot-assembled Linux system on a bootable ISO. The image identifies itself: it contains
`PRETTY_NAME="Buildroot 2013.08.1"`, `NAME=Buildroot`, `Welcome to Buildroot`, and
`BusyBox v1.21.1 (2014-02-13 02:54:33 CET)`.

- **Linux kernel** — GPL-2.0-only, with the syscall-note exception. Source: <https://www.kernel.org/>.
- **BusyBox 1.21.1** — GPL-2.0-only. Source: <https://busybox.net/downloads/busybox-1.21.1.tar.bz2>.
- **Buildroot 2013.08.1** (the build system and its packaging) — GPL-2.0-or-later. Source: <https://buildroot.org/downloads/buildroot-2013.08.1.tar.gz>.

The full GPLv2 text is in `LICENSE` beside this file.

## `freedos722.img` — 737,280 bytes, booted by `/labs/dos`

A 720 KB FreeDOS boot floppy. The image contains `FreeDOS`, `KERNEL  SYS`,
`FreeDOS kernel version %d.%d.%d`, and FreeCOM's banner strings including
`FREECOM FreeDOS STRINGS v3`, `freecom@freedos.org` and
`Copyright (C) 1994-2001 Tim Norman and others.` — followed by the GPL boilerplate
"the Free Software Foundation; either version 2 of the License, or (at your option)".

- **FreeDOS kernel** — GPL-2.0. Source: <https://github.com/FDOS/kernel>.
- **FreeCOM** (the `COMMAND.COM` shell) — GPL-2.0, © 1994–2001 Tim Norman and others. Source: <https://github.com/FDOS/freecom>.

The full GPLv2 text is in `LICENSE` beside this file.

## `openbsd.img` — 1,474,560 bytes, booted by `/labs/bsd`

A 1.44 MB OpenBSD/i386 boot floppy. The only version-bearing strings the image exposes are the
bootloader's own — `>> OpenBSD/i386 BOOT %s`, where `%s` is filled in at runtime — plus
`inflate 1.1.3 Copyright 1995-1998 Mark Adler` from the decompressor. In `copy/v86`'s fetch
list this file is named `openbsd-floppy.img`; it was renamed to `openbsd.img` when vendored.

OpenBSD's base system is permissively licensed — the project's policy is the ISC licence for
new code, with older BSD-licensed files throughout — but those notices live per file inside the
compiled kernel and installer, and cannot be recovered from this image. Attribution is
therefore given as: OpenBSD, © the OpenBSD project and its many individual contributors,
<https://www.openbsd.org/>.

## Source availability

All three images are unmodified upstream binaries. For the GPLv2 components above, the
corresponding source is the upstream release named beside each one, and the upstream projects
publish it themselves; this repository redistributes the binaries only, and passes along those
offers rather than making a new one. If a copy of the source is ever wanted directly from this
site rather than from upstream, ask via the contact page and it will be provided.

## UNRESOLVED — for the repository owner to settle

1. **The Linux kernel version in `linux.iso` is unknown.** The kernel is compressed inside the
   ISO and no `Linux version …` banner survives in the printable strings. Naming the exact
   release would make the source pointer above precise instead of generic.
2. **The FreeDOS distribution and kernel version are unknown.** The image carries the format
   string `FreeDOS kernel version %d.%d.%d` but not a filled-in copy of it.
3. **The OpenBSD release is unknown**, so the source pointer for it is the project rather than a
   specific release tree.
4. **Neither floppy has been inventoried file by file.** FreeDOS ships utilities under a mix of
   GPL, BSD and public-domain terms, and a 720 KB image may hold several. The GPLv2 statement
   above covers the kernel and shell, which are the components the image actually identifies;
   it is not a claim about every byte on the disk.
5. **A formal GPLv2 §3 written offer has not been drafted.** The paragraph above is a
   good-faith source-availability statement. Because these are unmodified upstream artefacts,
   §3(c) allows passing along the offer received with them, but if this site ever ships a
   *modified* image, §3(a) or §3(b) applies and this section has to be rewritten.
