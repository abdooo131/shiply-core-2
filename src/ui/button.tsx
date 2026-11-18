import type { ButtonHTMLAttributes } from 'react';

type ButtonVariant = 'default' | 'primary' | 'lime' | 'ghost' | 'danger';

export function Button({
  variant = 'default',
  small = false,
  block = false,
  className,
  type = 'button',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; small?: boolean; block?: boolean }) {
  const classes = ['btn', variant !== 'default' && variant, small && 'sm', block && 'block', className]
    .filter(Boolean)
    .join(' ');
  return <button type={type} className={classes} {...rest} />;
}
