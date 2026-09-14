// The composition: ten slides in a Series, one component per slide id. The
// Record type makes the compiler refuse a slide table entry that has no
// slide, and a slide that is not in the table.
import type { FC } from "react";
import { AbsoluteFill, Series } from "remotion";
import { SLIDES, type SlideId } from "./slides";
import { THEME } from "./theme";
import { AnnotateSlide } from "./slides/AnnotateSlide";
import { CaptureSlide } from "./slides/CaptureSlide";
import { DocumentedSlide } from "./slides/DocumentedSlide";
import { GuardrailsSlide } from "./slides/GuardrailsSlide";
import { PeopleSlide } from "./slides/PeopleSlide";
import { ProblemSlide } from "./slides/ProblemSlide";
import { ProjectSlide } from "./slides/ProjectSlide";
import { ShareSlide } from "./slides/ShareSlide";
import { StackSlide } from "./slides/StackSlide";
import { TitleSlide } from "./slides/TitleSlide";

export interface SlideProps {
  index: number;
}

export const SLIDE_COMPONENTS: Record<SlideId, FC<SlideProps>> = {
  title: TitleSlide,
  problem: ProblemSlide,
  people: PeopleSlide,
  project: ProjectSlide,
  capture: CaptureSlide,
  annotate: AnnotateSlide,
  share: ShareSlide,
  guardrails: GuardrailsSlide,
  stack: StackSlide,
  documented: DocumentedSlide,
};

export const Walkthrough: FC = () => (
  <AbsoluteFill style={{ background: THEME.bg }}>
    <Series>
      {SLIDES.map((slide, index) => {
        const Slide = SLIDE_COMPONENTS[slide.id];
        return (
          <Series.Sequence
            key={slide.id}
            durationInFrames={slide.durationInFrames}
            name={slide.title}
          >
            <Slide index={index} />
          </Series.Sequence>
        );
      })}
    </Series>
  </AbsoluteFill>
);
