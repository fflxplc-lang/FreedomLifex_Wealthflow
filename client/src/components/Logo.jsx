// Freedom LifeX logo, loaded from client/public/logo.png.
export default function Logo({ size = 'sm' }) {
  const big = size === 'lg';
  return (
    <img src={`${import.meta.env.BASE_URL}logo.png`} alt="Freedom LifeX" style={{ height: big ? 150 : 64, width: 'auto', maxWidth: '100%', objectFit: 'contain', display: 'block' }} />
  );
}
