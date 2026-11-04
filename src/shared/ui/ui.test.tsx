import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Icon } from './Icon';
import { EmptyIllustration, HeroIllustration, ShotDiagram } from './Illustrations';

describe('그림과 아이콘', () => {
  it.each([
    ['top', '상판'],
    ['bottom', '바닥면'],
    ['left', '왼쪽 옆면'],
    ['right', '오른쪽 옆면'],
    ['hinge', '힌지'],
    ['front', '앞쪽 면'],
    ['keyboard', '키보드'],
    ['screen_off', '꺼진 화면'],
    ['unknown', '노트북'],
  ])('촬영 컷 %s 그림은 어느 면인지 이름을 가진다', (code, text) => {
    render(<ShotDiagram code={code} className="x" />);
    expect(screen.getByRole('img')).toHaveAccessibleName(expect.stringContaining(text));
  });

  it('장식 그림과 아이콘은 스크린 리더에서 숨긴다', () => {
    const { container } = render(
      <>
        <HeroIllustration />
        <EmptyIllustration />
        <Icon name="laptop" className="big" />
      </>,
    );
    const svgs = container.querySelectorAll('svg');
    expect(svgs).toHaveLength(3);
    svgs.forEach((s) => expect(s).toHaveAttribute('aria-hidden', 'true'));
    expect(svgs[2]).toHaveClass('icon', 'big');
  });
});
