import React from "react";
import { Composition } from "remotion";
import { Promo, calculatePromoMetadata, defaultPromoProps } from "./Promo";

export const Root: React.FC = () => {
  return (
    <>
      <Composition
        id="promo"
        component={Promo}
        width={1080}
        height={1920}
        fps={30}
        durationInFrames={900}
        defaultProps={defaultPromoProps}
        calculateMetadata={calculatePromoMetadata}
      />
    </>
  );
};
