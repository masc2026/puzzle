#!/usr/bin/env python
# coding: utf-8
# PlayPuzzle.py

''' play puzzle '''

__version__ = '1.0.4'

import sys
if sys.version_info < (3, 13):
    sys.exit("This script requires Python 3.13 or higher. Please upgrade your Python version.")
else:
    sys.path.append("./lib/313")
import PuzzleBoard
import argparse
from argparse import ArgumentDefaultsHelpFormatter, BooleanOptionalAction
import os
import datetime
from PIL import Image
import matplotlib.pyplot as plt
import shutil

class CustomFormatter(argparse.ArgumentDefaultsHelpFormatter,
                      argparse.RawDescriptionHelpFormatter):
    pass

def validate_and_compute_parts(minparts, maxparts):
    LO, HI = 2, 4950

    if minparts is not None and not (LO <= minparts <= HI):
        print(f"--minparts {minparts} out of range [{LO}..{HI}]")
        sys.exit(1)
    if maxparts is not None and not (LO <= maxparts <= HI):
        print(f"--maxparts {maxparts} out of range [{LO}..{HI}]")
        sys.exit(1)

    if minparts is None and maxparts is None:
        minparts, maxparts = 10, 20
    elif minparts is None:
        if maxparts < LO + 10:
            print(f"--maxparts {maxparts} too small, need >= {LO+10}")
            sys.exit(1)
        minparts = maxparts - 10
    elif maxparts is None:
        if minparts > HI - 10:
            print(f"--minparts {minparts} too large, need <= {HI-10}")
            sys.exit(1)
        maxparts = minparts + 10
    else:
        if maxparts - minparts < 1:
            print(f"--maxparts - --minparts = {maxparts-minparts}, must be >= 1")
            sys.exit(1)

    if not (LO <= minparts <= HI and LO <= maxparts <= HI):
        print("computed range out of bounds")
        sys.exit(1)

    return minparts, maxparts

def check_photo_size(value):
    try:
        ivalue = int(value)
    except ValueError:
        print(f"--pwidth/--pheight: integer expected, but '{value}' was given")
        sys.exit(1)

    if ivalue < 100:
        print(f"--pwidth/--pheight {ivalue} too small (min 100)")
        sys.exit(1)
    if ivalue > 50000:
        print(f"--pwidth/--pheight {ivalue} too large (max 50000)")
        sys.exit(1)
    return ivalue


def check_photo_dpi(value):
    try:
        ivalue = int(value)
    except ValueError:
        print(f"--dpi: integer expected, but '{value}' was given")
        sys.exit(1)

    if ivalue < 50:
        print(f"--dpi {ivalue} too small (min 50)")
        sys.exit(1)
    if ivalue > 1000:
        print(f"--dpi {ivalue} too large (max 1000)")
        sys.exit(1)
    return ivalue


def check_pz_percent(value):
    try:
        ivalue = int(value)
    except ValueError:
        print(f"--pz: integer expected, but '{value}' was given")
        sys.exit(1)

    if ivalue < 0:
        print(f"--pz {ivalue} too small (min 0)")
        sys.exit(1)
    if ivalue > 100:
        print(f"--pz {ivalue} too large (max 100)")
        sys.exit(1)
    return ivalue

def check_command_exists(cmd):
    readme_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "README.md"))
    if shutil.which(cmd) is None:
        sys.exit(
            f"Error: '{cmd}' is not installed or not in PATH. "
            f"See file://{readme_path}"
        )

def check_requirements(args):
    if args.animate:
        if args.animate == "webp":
            check_command_exists("webpmux")
        elif args.animate == "apng":
            check_command_exists("apngasm")
    if args.pz and args.pz > 0:
        check_command_exists("convert")

valid_c_values = ['k', 'b', 'r']

valid_f_values = ['png', 'svg']

valid_an_values = ['apng', 'webp']

parser = argparse.ArgumentParser(
    prog="PlayPuzzle",
    description="PlayPuzzle – Generator und Renderer",
    epilog="""Beispiel: Baue aus dem Bild ein Puzzle mit 30 bis 40 Teilen und erstelle ein neues Bild mit 60 % der Teile. Der Wert für 'seed' bestimmt die zufällige Anordnung.
 
  python PlayPuzzle.py --minparts 30 --maxparts 40 --seed 35 --photo photoA.jpg --pz 60

  docker run -it -v .:/app --rm puzzle --minparts 30 --maxparts 40 --seed 35 --photo photoA.jpg --pz 60
  """,
    formatter_class=CustomFormatter
)

# Version
parser.add_argument(
    "-v", "--version",
    action="version",
    version = f"PlayPuzzle v{__version__}{os.linesep}PuzzleBoard v{PuzzleBoard.__version__}"
)

# Allgemein / Ausgabe
out_grp = parser.add_argument_group("Ausgabe")
out_grp.add_argument(
    "-f", "--format",
    choices=valid_f_values,
    default="png",
    help="Ausgabeformat",
    metavar="<fmt>",
)
out_grp.add_argument(
    "-c", "--color",
    choices=valid_c_values,
    default="k",
    help='Füllfarbe (z. B. "k" = schwarz)',
    metavar="<farbe>",
)
out_grp.add_argument(
    "--by-type-subdirs",
    action="store_true",
    default=False,
    help="Puzzleteile in Typsubordnern speichern",
)
#out_grp.add_argument(
#    "--bevel-pause",
#    action="store_true",
#    default=False,
#    help="Vor dem Beveling pausieren für manuelle Anpassung",
#)
out_grp.add_argument(
    "--swap-twins",
    action="store_true",
    default=False,
    help="Paarweise identisch geformte Teile beim Zusammenbau tauschen",
)

# Animation
anim_grp = parser.add_argument_group("Animation")
anim_grp.add_argument(
    "--animate",
    choices=valid_an_values,
    default=None,
    help="Puzzle-Animation mit angegebenem Format erzeugen",
    metavar="<fmt>",
)

# Foto/Render
photo_grp = parser.add_argument_group("Foto/Render")
photo_grp.add_argument(
    "--photo",
    type=str,
    default=None,
    help="Pfad zur Fotodatei",
    metavar="<file>",
)
photo_grp.add_argument(
    "--width",
    type=check_photo_size,
    default=None,
    help="Foto-Breite in Pixel",
    metavar="<int>",
)
photo_grp.add_argument(
    "--height",
    type=check_photo_size,
    default=None,
    help="Foto-Höhe in Pixel",
    metavar="<int>",
)
photo_grp.add_argument(
    "--dpi",
    type=check_photo_dpi,
    default=plt.rcParams["figure.dpi"],
    help="Foto-DPI",
    metavar="<int>",
)

# Puzzle-Logik / Zufall
logic_grp = parser.add_argument_group("Puzzle-Logik")
logic_grp.add_argument(
    "--pz",
    type=check_pz_percent,
    default=0,
    help="Neues Foto mit Anteil der Puzzleteile (0..100)",
    metavar="<0-100>",
)
logic_grp.add_argument(
    "--equal-pairs",
    dest="ep",
    type=int,
    default=0,
    help="Versuch, paarweise identische Formen zu erzeugen",
    metavar="<int>",
)
logic_grp.add_argument(
    "--seed",
    type=int,
    default=92,
    help="Initialer Zufalls-Seed",
    metavar="<int>",
)

# (optional) Grenzen Anzahl Teile
limit_grp = parser.add_argument_group("Teile-Grenzen")
limit_grp.add_argument(
    "--minparts",
    type=int,
    default=None,
    help="Minimale Teilezahl (≥2, ≤4950)",
    metavar="<int>",
)
limit_grp.add_argument(
    "--maxparts",
    type=int,
    default=None,
    help="Maximale Teilezahl (≥2, ≤4950)",
    metavar="<int>",
)

args = parser.parse_args()

check_requirements(args)

mn, mx = validate_and_compute_parts(args.minparts, args.maxparts)

if (args.height and args.width and not args.photo) or (args.photo and not args.height and not args.width):
  pass 
else:
  parser.error('Set both --width and --height or only --photo.')

if (args.pz>0 and not (args.photo)):
  parser.error('If the --pz option is set >0, choose a photo to puzzle.')
else:
  args.format=="png"
  pass

PuzzleBoard.PuzzleConfig.NUMBER_EP=args.ep
PuzzleBoard.PuzzleConfig.MASK_COLOUR=args.color
PuzzleBoard.PuzzleConfig.LINE_LEN=10
PuzzleBoard.PuzzleConfig.PHOTO=args.photo
PuzzleBoard.PuzzleConfig.OT=args.by_type_subdirs
#PuzzleBoard.PuzzleConfig.CB=args.bevel_pause
PuzzleBoard.PuzzleConfig.UE=args.swap_twins
PuzzleBoard.PuzzleConfig.PZ=args.pz
PuzzleBoard.PuzzleConfig.AN=args.animate
PuzzleBoard.PuzzleConfig.FORMAT=args.format
PuzzleBoard.PuzzleConfig.SEED=args.seed

input_image = Image.open(PuzzleBoard.PuzzleConfig.PHOTO) if not(PuzzleBoard.PuzzleConfig.PHOTO is None) else None 
PuzzleBoard.PuzzleConfig.PHOTO_WIDTH=args.width if input_image is None else input_image.width
PuzzleBoard.PuzzleConfig.PHOTO_HEIGHT=args.height if input_image is None else input_image.height
if not(input_image is None):
  input_image.close()
PuzzleBoard.PuzzleConfig.PHOTO_DPI=args.dpi

PuzzleBoard.PuzzleConfig.PUZZLE_PARTS_MIN = mn
PuzzleBoard.PuzzleConfig.PUZZLE_PARTS_MAX = mx

timestamp = datetime.datetime.now().strftime("%Y%m%d%H%M%S")
subdirectory = "tmp_" + timestamp
current_directory = os.path.dirname(os.path.abspath(__file__ or '.'))
target_directory = os.path.join(current_directory, subdirectory)

game=PuzzleBoard.PuzzleBoard(PuzzleBoard.PuzzleConfig.SEED)
game.create()
game.plotMasks(target_directory)
if PuzzleBoard.PuzzleConfig.FORMAT=="png" and not(PuzzleBoard.PuzzleConfig.PHOTO is None):
  game.createPuzzles(args.photo,target_directory)
  if PuzzleBoard.PuzzleConfig.PZ>0:
    print("Play puzzle")
    game.makePuzzle(target_directory)