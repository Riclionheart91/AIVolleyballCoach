import { useRef } from "react";
import { Animated, PanResponder } from "react-native";

/**
 * Un foglio che sale dal basso (menu azioni, scelte) si chiude trascinandolo verso il basso, come su iPhone.
 * Uso: <Animated.View style={[stileCarta, t.stile]} {...t.panHandlers}>.
 */
export function useTrascinaPerChiudere(chiudi: () => void) {
  const y = useRef(new Animated.Value(0)).current;
  const chiudiRef = useRef(chiudi);
  chiudiRef.current = chiudi;

  const torna = () => Animated.spring(y, { toValue: 0, useNativeDriver: false, bounciness: 6 }).start();

  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => g.dy > 6 && g.dy > Math.abs(g.dx),
      onPanResponderTerminationRequest: () => false,
      onPanResponderMove: (_e, g) => y.setValue(Math.max(0, g.dy)),
      onPanResponderRelease: (_e, g) => {
        if (g.dy > 90 || g.vy > 0.9) {
          Animated.timing(y, { toValue: 600, duration: 160, useNativeDriver: false }).start(() => { chiudiRef.current(); y.setValue(0); });
        } else torna();
      },
      onPanResponderTerminate: torna,
    }),
  ).current;

  return { stile: { transform: [{ translateY: y }] }, panHandlers: pan.panHandlers };
}
