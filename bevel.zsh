#!/usr/bin/env zsh

zmodload zsh/zutil
zmodload zsh/mathfunc

zparseopts -D -E -A opts tsdir:=opts  cb:=opts sm:=opts

local tsdir=$opts[-tsdir]
local cb="${opts[-cb]:-false}"
local sm="${opts[-sm]:-false}"

if command -v magick >/dev/null; then
    function convert()  { magick "$@"; }
fi

# Skaliert die Effekt-Parameter relativ zur längsten Bildkante (Default-Referenz: 300 px)
# Aufruf: puzzle_bevel_dynamic "/pfad/img.png" [ref_kante]
puzzle_bevel_dynamic() {
    local png_file="$1"
    local ref="${2:-300}"   # Referenzkante (Sweet-Spot)

    local file_path_base_name="${png_file:r}"
    local mask="${file_path_base_name}_mask.png"
    local overlay="${file_path_base_name}_overlay.png"
    local out="${file_path_base_name}_bevel.png"

    f=$(identify -ping -format "%w %h" "$png_file")
    w=${f%% *}   # alles vor dem ersten Leerzeichen
    h=${f##* }   # alles nach dem letzten Leerzeichen

    # Skalenfaktor anhand der längeren Kante
    local s
    # längere Seite bestimmen
    (( m = (w > h ? w : h) ))
    (( ref = ref > 0 ? ref : 300 ))
    # Skalenfaktor als Float
    s=$(( m * 1.0 / ref ))

    # Dynamische Parameter (mit sinnvollen Limits)
    # float-Variablen
    typeset -F blurSigma sigmoid colorizePct

    # blurSigma: 2*s, begrenzt auf [0.3, 20]
    blurSigma=$(( 2.0 * s ))
    (( blurSigma < 0.3 )) && blurSigma=0.3
    (( blurSigma > 20.0 )) && blurSigma=20.0

    # sigmoid: 2*sqrt(s), begrenzt auf [0.8, 5]
    sigmoid=$(( 2.0 * sqrt(s) ))
    (( sigmoid < 0.8 )) && sigmoid=0.8
    (( sigmoid > 5.0 )) && sigmoid=5.0

    # colorizePct: 10*sqrt(s), begrenzt auf [6, 18], ganzzahlig
    colorizePct=$(( int(10.0 * sqrt(s)) ))
    (( colorizePct < 6 )) && colorizePct=6
    (( colorizePct > 18 )) && colorizePct=18

    # Basis-Winkel
    azimuth=120.0
    elevation=$(( 20.0 / s ))

    # Clamp Werte: nicht kleiner als 5°, nicht größer als 45°
    (( elevation < 5.0 )) && elevation=25.0
    (( elevation > 45.0 )) && elevation=25.0

    # 1) Alphamaske
    convert "$png_file" -alpha extract "$mask" || { rm -f "$mask"; return 1; }

    # 2) Overlay aus der Maske mit dynamischen Werten bauen
    convert "$mask" \
    \( +clone -blur 0x"$blurSigma" -shade ${azimuth}x${elevation} -contrast-stretch 0% \
        +sigmoidal-contrast "$sigmoid"x50% -fill gray70 -colorize "$colorizePct"% \) +swap \
    -alpha off -compose CopyOpacity -composite \
    "$overlay" || { rm -f "$mask" "$overlay"; return 1; }

    # 3) Overlay auf Original legen
    convert "$png_file" "$overlay" -compose Hardlight -composite "$out" || {
    rm -f "$mask" "$overlay"
    return 1
    }

    # 4) Aufräumen
    rm -f "$mask" "$overlay"
}

# make_overlay_keep_axis_edges <mask> <overlay_out> <blurSigma> <azimuth> <elevation> <sigmoid> <colorizePct> <sides>
# sides: Zeichenkette aus T,R,B,L (Top, Right, Bottom, Left); z.B. "TR" oder "BL" oder "".
# IM7-Version: Bevel überall, aber an angegebenen Außenkanten (T/R/B/L) "hart" lassen
# Aufruf:
#   make_overlay_keep_axis_edges <mask> <overlay_out> <blurSigma> <az> <el> <sig> <col> <sides> [<bw>]
#     sides: Kombination aus T,R,B,L (z.B. "TR", "BL", "" = keine harte Kante)
#     bw:    optionale Streifenbreite in Pixel; wenn leer -> ~2*blurSigma (min 1, max 40)
make_overlay_keep_axis_edges() {
  local mask="$1" out="$2" blurSigma="$3" az="$4" el="$5" sig="$6" col="$7" sides="$8" bw="$9"

  # Bildgröße (IM7)
  local f w h

  f=$(identify -ping -format "%w %h" "$mask") || return 1
  w=${f%% *}
  h=${f##* }

echo "f = $f"
echo "w = $w"
echo "h = $h"

  # Seiten-Streifenbreite (Heuristik, falls nicht vorgegeben)
  if [[ -z "$bw" ]]; then
    typeset -F bs; bs=$blurSigma
    bw=$(( int(2.0*bs + 0.5) ))
    (( bw < 1 ))  && bw=1
    (( bw > 40 )) && bw=40
  fi

  # --- Motiv-Bounding-Box aus Alpha bestimmen ---
  # 1px Border verhindert Off-by-one bei -trim
  local bbox x y mw mh
    bbox=$(
    magick "$mask" \
        -bordercolor black -border 1x1 -trim \
        -format "%[fx:page.x-1] %[fx:page.y-1] %[fx:w] %[fx:h]" info:
    ) || return 1
  x=${bbox%% *}; bbox=${bbox#* }
  y=${bbox%% *}; bbox=${bbox#* }
  mw=${bbox%% *}; mh=${bbox#* }

  # Motiv-Margen relativ zur Bildkante
  local ml mt mr mb
  ml=$x
  mt=$y
  mr=$(( w - (x + mw) ))
  mb=$(( h - (y + mh) ))

  # -draw-Argumente: Streifen an den MOTIV-Kanten statt Bildkanten
  local -a draw_opts=()
  # Top-Streifen: an y = mt
  [[ "$sides" == *T* ]] && draw_opts+=(-draw "rectangle 0,$mt $((w-1)),$((mt + bw - 1))")
  # Bottom-Streifen: an y = h - mb - 1 (Motiv-Unterkante)
  [[ "$sides" == *B* ]] && draw_opts+=(-draw "rectangle 0,$((h - mb - bw)) $((w-1)),$((h - mb - 1))")
  # Left-Streifen: an x = ml
  [[ "$sides" == *L* ]] && draw_opts+=(-draw "rectangle $ml,0 $((ml + bw - 1)),$((h-1))")
  # Right-Streifen: an x = w - mr - 1 (Motiv-Rechtskante)
  [[ "$sides" == *R* ]] && draw_opts+=(-draw "rectangle $((w - mr - bw)),0 $((w - mr - 1)),$((h-1))")

echo "w = $w"
echo "h = $h"
echo "ml = $ml"
echo "mt = $mt"
echo "mr = $mr"
echo "mb = $mb"
echo "bw = $bw"
echo "sides = $sides"
echo "draw_opts = $draw_opts"

  # Tempfiles im Masken-Verzeichnis ablegen (nur der Pfad, kein Dateiname)
    local dir="${mask:h:A}"
    local soft="$dir/soft.png"
    local flat="$dir/flat.png"
    local axis="$dir/axis.png"
    local flatA="$dir/flatA.png"
    local softA="$dir/softA.png"

  # 1) soft (ehem. mpr:soft)
    magick "$mask" \
    \( +clone -blur 0x"$blurSigma" -shade ${az}x${el} -contrast-stretch 0% \
        +sigmoidal-contrast "${sig}"x50% -fill gray70 -colorize "${col}"% \) +swap \
    -alpha off -compose CopyOpacity -composite \
    "$soft" || return 1

  # 2) flat (ehem. mpr:flat)
    magick -size "${w}x${h}" canvas:gray70 \
    "$mask" -compose CopyOpacity -composite "$flat"

  # 3) axis (Streifen an Motiv-Kanten)
  magick -size "${w}x${h}" canvas:black -fill white -stroke none \
    "${draw_opts[@]}" \
    "$axis" || return 1

  # 4) flatA
  magick "$flat" "$axis" -compose CopyOpacity -composite "$flatA" || return 1

  # 5) softA
  magick "$soft" \( "$axis" -negate \) -compose CopyOpacity -composite "$softA" || return 1

  # 6) combine
  magick "$softA" "$flatA" -compose Over -composite "$out" || return 1
}


# Skaliert die Effekt-Parameter relativ zur längsten Bildkante (Default-Referenz: 300 px)
# Aufruf: puzzle_bevel_dynamic_test "/pfad/img.png" [ref_kante]
puzzle_bevel_dynamic_test() {
    local png_file="$1"
    local ref="${2:-300}"   # Referenzkante (Sweet-Spot)

    local file_path_base_name="${png_file:r}"
    local mask="${file_path_base_name}_mask.png"
    local overlay="${file_path_base_name}_overlay.png"
    local overlay_flat="${file_path_base_name}_overlay_flat.png"
    local out="${file_path_base_name}_bevel.png"

    f=$(identify -ping -format "%w %h" "$png_file")
    w=${f%% *}   # alles vor dem ersten Leerzeichen
    h=${f##* }   # alles nach dem letzten Leerzeichen

    # Skalenfaktor anhand der längeren Kante
    local s
    # längere Seite bestimmen
    (( m = (w > h ? w : h) ))
    (( ref = ref > 0 ? ref : 300 ))
    # Skalenfaktor als Float
    s=$(( m * 1.0 / ref ))

    # Dynamische Parameter (mit sinnvollen Limits)
    # float-Variablen
    typeset -F blurSigma sigmoid colorizePct

    # blurSigma: 2*s, begrenzt auf [0.3, 20]
    blurSigma=$(( 2.0 * s ))
    (( blurSigma < 0.3 )) && blurSigma=0.3
    (( blurSigma > 20.0 )) && blurSigma=20.0

    # sigmoid: 2*sqrt(s), begrenzt auf [0.8, 5]
    sigmoid=$(( 2.0 * sqrt(s) ))
    (( sigmoid < 0.8 )) && sigmoid=0.8
    (( sigmoid > 5.0 )) && sigmoid=5.0

    # colorizePct: 10*sqrt(s), begrenzt auf [6, 18], ganzzahlig
    colorizePct=$(( int(10.0 * sqrt(s)) ))
    (( colorizePct < 6 )) && colorizePct=6
    (( colorizePct > 18 )) && colorizePct=18

    # Basis-Winkel
    azimuth=120.0
    elevation=$(( 20.0 / s ))

    # Clamp Werte: nicht kleiner als 5°, nicht größer als 45°
    (( elevation < 5.0 )) && elevation=25.0
    (( elevation > 45.0 )) && elevation=25.0

    # 1) Alphamaske
    convert "$png_file" -alpha extract "$mask" || { return 1; }

    # 2) Overlay aus der Maske mit dynamischen Werten bauen
    convert "$mask" \
    \( +clone -blur 0x"$blurSigma" -shade ${azimuth}x${elevation} -contrast-stretch 0% \
        +sigmoidal-contrast "$sigmoid"x50% -fill gray70 -colorize "$colorizePct"% \) +swap \
    -alpha off -compose CopyOpacity -composite \
    "$overlay" || { return 1; }

    convert "$mask" \
    \( +clone -blur 0x"$blurSigma" -shade ${azimuth}x${elevation} -contrast-stretch 0% \
        +sigmoidal-contrast "$sigmoid"x50% -fill gray70 -colorize "$colorizePct"% \) +swap \
    -alpha off -compose CopyOpacity -composite \
    "$overlay_flat" || { return 1; }

    # 3) Overlay auf Original legen
    convert "$png_file" "$overlay" -compose Hardlight -composite "$out" || {
    #rm -f "$mask" "$overlay"
    return 1
    }

    # 4) Aufräumen
    #rm -f "$mask" "$overlay"
}

# Batch-Funktion, mit dynamic-Scaling
imagemagick_bevel_scale_effects() {
  setopt local_options null_glob
  for png_file in "$tsdir"/**/img_puzzle{,_twin}_*.png; do
    # Optional: Referenz anpassen, Standard ist 300
    puzzle_bevel_dynamic "$png_file" 300
  done
}


imagemagick_bevel ()
{
    setopt local_options null_glob
    for png_file in "$tsdir"/**/img_puzzle{,_twin}_*.png; do
        local file_path_base_name="${png_file:r}"
        local out_file="${file_path_base_name}_bevel.png"

        convert "$png_file" -alpha extract "${file_path_base_name}_mask.png"

        convert "${file_path_base_name}_mask.png" \( +clone -blur 0x2 -shade 120x20 -contrast-stretch 0% +sigmoidal-contrast 2x50% -fill grey70 -colorize 10%  \) +swap -alpha Off -compose CopyOpacity -composite "${file_path_base_name}_overlay.png"

        convert "${png_file}" "${file_path_base_name}_overlay.png" -compose Hardlight -composite "${file_path_base_name}_bevel.png"

        rm -f "${file_path_base_name}_mask.png" "${file_path_base_name}_overlay.png"
    done
}

imagemagick_outline () {
    setopt local_options null_glob
    for png_file in "$tsdir"/**/img_puzzle{,_twin}_*.png; do
        local base="${png_file:r}"
        local mask_file="${base}_mask.png"
        local dilate_file="${base}_dilate.png"
        local edge_file="${base}_edge.png"
        local out_file="${base}_bevel.png"

        # 1. Maske (weiß = Motiv, schwarz = transparent)
        convert "$png_file" -alpha extract "$mask_file"

        # 2. Dilatierte Maske (vergrößert Motiv nach außen)
        convert "$mask_file" -morphology Dilate:3 Octagon "$dilate_file"

        # 3. Differenz = nur Rand
        convert "$dilate_file" "$mask_file" -compose minus_src -composite "$edge_file"

        # 4. Rand einfärben + Hintergrund transparent machen
        convert "$edge_file" \
            -threshold 50% \
            -fill white -opaque white \
            -transparent black \
            "$edge_file"

        # 5. Rand + Originalbild kombinieren
        convert "$png_file" "$edge_file" -compose over -composite "$out_file"

        # 6. Aufräumen
        rm -f "$mask_file" "$dilate_file" "$edge_file"
    done
}

imagemagick_outline_soft () {
    setopt local_options null_glob
    local width_px="${1:-5}"      # Randbreite in Pixel (Dilatation)
    local feather="${2:-2.5}"     # Weichzeichnung (Gaussian Sigma)
    local color="${3:-white}"     # Randfarbe
    local opacity="${4:-50}"      # Deckkraft 0-100 (100 = vollständig)
    local oversample="${5:-1.0}"  # z.B. 2.0 für Upscale/Downscale

    for png_file in "$tsdir"/**/img_puzzle{,_twin}_*.png; do
        local base="${png_file:r}"
        local mask="${base}_mask.png"
        local dil="${base}_dilate.png"
        local edge="${base}_edge.png"
        local alpha="${base}_alpha.png"
        local blured="${base}_blured.png"
        local outline="${base}_bevel.png"
        local tmp="${base}_tmp.png"

        # optional: Oversampling für glattere Kanten
        if (( $(printf '%.0f' "$(echo "$oversample > 1" | bc)") )); then
            magick "$png_file" -filter Lanczos -resize "$((100*oversample))%" "$tmp"
        else
            cp "$png_file" "$tmp"
        fi

        # 1) Binäre Maske (weiß=Motiv)
        magick "$tmp" -alpha extract "$mask"

        # 2) Dilatierte Maske (vergrößert Motiv nach außen)
        magick "$mask" -morphology Dilate:"$width_px" Octagon "$dil"

        # 3) Ring (nur Rand): Dilate minus Originalmaske
        magick "$dil" "$mask" -compose minus_src -composite "$edge"

        # 4) Weiche Alpha-Kante: leicht blurren + auf 0/255 spreizen
        #    (Threshold sorgt dafür, dass feine Rauschkanten weg sind)
        magick "$edge" -gaussian-blur 0x"$feather" -level 5%,100% -threshold 1% "$alpha"

        # 5) Farbige Randebene mit transparenter (geblurter) Alpha
        #    Deckkraft über -evaluate Multiply steuern (0..1)
        magick -size "$(magick identify -format %wx%h "$tmp")" canvas:"$color" \
            \( "$alpha" -evaluate Multiply "$(awk -v o="$opacity" 'BEGIN{printf("%.3f", o/100)}')" \) \
            -compose CopyOpacity -composite "$blured"

        # 6) Rand + Original kombinieren
        magick "$tmp" "$blured" -compose over -composite "$outline"

        # optional: zurück auf Originalgröße
        if (( $(printf '%.0f' "$(echo "$oversample > 1" | bc)") )); then
            magick "$outline" -filter Lanczos -resize "$((100/oversample))%" "${base}_outline.png"
            rm -f "$outline"
        fi

        # Aufräumen
        #rm -f "$mask" "$dil" "$edge" "$alpha" "$tmp"
    done
}



custom_bevel ()
{
    echo ">>> Add custom bevel effects on img_puzzle{,_twin}_*.png in ./tmp_$tsdir now and then press <ENTER>."
    read -k REPLY

    for png_file in $tsdir/**/img_puzzle{,_twin}_*.png; do
        bevel_png_file="${png_file:r}_bevel.png"

        cp -f "$png_file" "$bevel_png_file"
    done
}

if [[ ! $sm == "false" ]]; then
    local pznr=$opts[-sm]
    echo "Bevel puzzle ${tsdir}/img_puzzle_${pznr}.png"
    puzzle_bevel_dynamic_test $tsdir/img_puzzle_${pznr}.png
else
    if [[ $cb == "true" ]]; then
        custom_bevel
    else
        #imagemagick_bevel_scale_effects
        imagemagick_bevel
        #imagemagick_outline
        #imagemagick_outline_soft
    fi
fi
