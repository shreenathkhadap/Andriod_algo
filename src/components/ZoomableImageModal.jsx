import { MaterialIcons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Modal,
  PanResponder,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import ImageActionBar from './ImageActionBar';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const BOX_W = SCREEN_W - 32;
const BOX_H = SCREEN_H - 160;
const MIN_SCALE = 1;
const MAX_SCALE = 4;
const ZOOM_STEP = 1.5;

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

// Drop-in replacement for the fullscreen "tap an alert image" modal every
// alert screen (Home, Monitor, Investigate, Notifications, Alert Report)
// used to duplicate individually — zoom in/out buttons (+ drag-to-pan once
// zoomed in) and a rotate button that toggles between portrait (0°) and
// landscape (90°), on top of the same download/share bar they all already
// had.
//
// Deliberately button-driven, not pinch/gesture-driven: a hand-rolled
// PanResponder pinch implementation (and later a react-native-gesture-handler
// rewrite) both proved unreliable/inconsistent on this project's Expo Go
// setup — the gesture-handler version also slowed down the whole app.
// Buttons sidestep all of that.
export default function ZoomableImageModal({
  visible,
  url,
  onClose,
  downloadImage,
  shareImage,
  downloadingUrl,
  sharingUrl,
}) {
  const scale       = useRef(new Animated.Value(1)).current;
  const translateX  = useRef(new Animated.Value(0)).current;
  const translateY  = useRef(new Animated.Value(0)).current;
  const rotateAnim  = useRef(new Animated.Value(0)).current;

  // Animated.Value has no reliable synchronous getter, so the pan-when-zoomed
  // math below is computed off these plain refs, kept in lockstep with every
  // .setValue() call.
  const scaleRef             = useRef(1);
  const translateRef         = useRef({ x: 0, y: 0 });
  const gestureStartTranslate = useRef({ x: 0, y: 0 });

  // Only two states — portrait (false/0°) and landscape (true/90°) — not a
  // free 4-way spin.
  const [isRotated, setIsRotated] = useState(false);
  // Mirrors `isRotated` for the PanResponder callbacks below, which are
  // created ONCE (useRef(PanResponder.create(...)).current only runs its
  // initializer on mount) — reading the `isRotated` STATE variable directly
  // inside them would always see its value from that first render (false),
  // never picking up later rotation toggles. Refs stay live across renders
  // without needing to recreate the responder.
  const isRotatedRef = useRef(false);
  useEffect(() => { isRotatedRef.current = isRotated; }, [isRotated]);

  const reset = () => {
    scaleRef.current = 1;
    translateRef.current = { x: 0, y: 0 };
    setIsRotated(false);
    scale.setValue(1);
    translateX.setValue(0);
    translateY.setValue(0);
    rotateAnim.setValue(0);
  };

  // A previous image's zoom/pan/rotation shouldn't carry over onto the next
  // one opened.
  useEffect(() => { if (visible) reset(); }, [visible, url]);

  // useNativeDriver: false is deliberate — translateX/Y are ALSO driven
  // imperatively via .setValue() while dragging (see the PanResponder
  // below); mixing that JS-driven updating with native-driver-animated
  // transitions on the SAME Animated.Value is what made an earlier pinch
  // version feel stuttery, since the two drivers fight over which one owns
  // the value's underlying native prop. Keeping this whole value family
  // JS-driven end-to-end (drag updates AND spring transitions) keeps it on
  // one consistent driver.
  const zoomTo = (next) => {
    scaleRef.current = next;
    Animated.spring(scale, { toValue: next, useNativeDriver: false }).start();
    if (next <= MIN_SCALE) {
      translateRef.current = { x: 0, y: 0 };
      Animated.parallel([
        Animated.spring(translateX, { toValue: 0, useNativeDriver: false }),
        Animated.spring(translateY, { toValue: 0, useNativeDriver: false }),
      ]).start();
    }
  };

  const zoomIn  = () => zoomTo(clamp(scaleRef.current * ZOOM_STEP, MIN_SCALE, MAX_SCALE));
  const zoomOut = () => zoomTo(clamp(scaleRef.current / ZOOM_STEP, MIN_SCALE, MAX_SCALE));

  // Drag-to-pan, only once zoomed in via the buttons above — a plain
  // single-finger PanResponder (no pinch/multi-touch tracking needed here).
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => scaleRef.current > MIN_SCALE,
      onMoveShouldSetPanResponder: (evt, gesture) =>
        scaleRef.current > MIN_SCALE && (Math.abs(gesture.dx) > 2 || Math.abs(gesture.dy) > 2),
      onPanResponderGrant: () => {
        gestureStartTranslate.current = { ...translateRef.current };
      },
      onPanResponderMove: (evt, gesture) => {
        // gesture.dx/dy are SCREEN-space deltas (drag right = dx>0), but
        // translateX/Y are applied to the inner image INSIDE the outer
        // Animated.View that carries the rotate transform — when rotated
        // 90°, that local coordinate frame is itself rotated relative to
        // the screen, so using the raw screen deltas directly moved the
        // image along the wrong axis. This rotates the delta back into the
        // image's local frame first (inverse of a +90° rotation:
        // localX = screenDY, localY = -screenDX) so a screen-right drag
        // always visually moves the image right, rotated or not.
        const { dx, dy } = isRotatedRef.current
          ? { dx: gesture.dy, dy: -gesture.dx }
          : { dx: gesture.dx, dy: gesture.dy };
        const next = {
          x: gestureStartTranslate.current.x + dx,
          y: gestureStartTranslate.current.y + dy,
        };
        translateRef.current = next;
        translateX.setValue(next.x);
        translateY.setValue(next.y);
      },
    })
  ).current;

  const toggleRotate = () => {
    const next = !isRotated;
    setIsRotated(next);
    Animated.timing(rotateAnim, { toValue: next ? 1 : 0, duration: 220, useNativeDriver: true }).start();
  };

  const spin = rotateAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '90deg'] });

  if (!url) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.toolbar}>
          <TouchableOpacity style={styles.toolBtn} onPress={toggleRotate} activeOpacity={0.7}>
            <MaterialIcons name="rotate-right" size={22} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.toolBtn} onPress={zoomOut} activeOpacity={0.7}>
            <MaterialIcons name="zoom-out" size={22} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.toolBtn} onPress={zoomIn} activeOpacity={0.7}>
            <MaterialIcons name="zoom-in" size={22} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.toolBtn} onPress={onClose} activeOpacity={0.7}>
            <MaterialIcons name="close" size={22} color="#fff" />
          </TouchableOpacity>
        </View>

        {/* Rotation swaps the box's own width/height (not just the visual
            transform) so the landscape (90°) state actually fills the screen
            in that orientation instead of being squeezed into a
            still-portrait-shaped frame. Must be Animated.View (not a plain
            View) — `spin` is an Animated interpolation node, and handing an
            Animated value to a plain component's style crashes immediately
            on render instead of animating it. */}
        <Animated.View
          style={[styles.imageWrap, isRotated && styles.imageWrapSideways, { transform: [{ rotate: spin }] }]}
          {...panResponder.panHandlers}
        >
          <Animated.Image
            source={{ uri: url }}
            style={[
              styles.image,
              isRotated && styles.imageSideways,
              // scale MUST come before translateX/Y: transforms compose in
              // array order, so translate-then-scale would additionally
              // scale the translation itself — a raw 100px drag would
              // visually move the image 200px at 2x zoom instead of 100px,
              // making the drag feel like it's tracking the finger at the
              // wrong rate. scale-then-translate keeps translateX/Y a
              // direct 1:1 screen-pixel mapping at any zoom level.
              { transform: [{ scale }, { translateX }, { translateY }] },
            ]}
            resizeMode="contain"
          />
        </Animated.View>

        <ImageActionBar
          url={url}
          downloadingUrl={downloadingUrl}
          sharingUrl={sharingUrl}
          onDownload={downloadImage}
          onShare={shareImage}
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.95)', justifyContent: 'center', alignItems: 'center' },
  toolbar: {
    position: 'absolute', top: 50, right: 16, zIndex: 10,
    flexDirection: 'row', gap: 10,
  },
  toolBtn: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center',
    borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.2)',
  },
  imageWrap:         { width: BOX_W, height: BOX_H, alignItems: 'center', justifyContent: 'center' },
  imageWrapSideways: { width: BOX_H, height: BOX_W },
  image:             { width: BOX_W, height: BOX_H },
  imageSideways:     { width: BOX_H, height: BOX_W },
});
