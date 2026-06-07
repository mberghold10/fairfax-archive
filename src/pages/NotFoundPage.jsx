import { Link } from 'react-router-dom';
import Breadcrumbs from '../components/Breadcrumbs.jsx';
import '../styles/not-found-page.css';

export default function NotFoundPage() {
  const crumbs = [
    { label: 'Home', to: '/' },
    { label: '404' },
  ];

  return (
    <div className="not-found-page">
      <Breadcrumbs crumbs={crumbs} />
      <div className="not-found-page__content">
        <h1 className="not-found-page__heading">404 — Page Not Found</h1>
        <p className="not-found-page__message">
          The page you're looking for doesn't exist or may have been moved.
        </p>
        <Link to="/" className="btn-primary not-found-page__home-link">
          Back to Home
        </Link>
      </div>
    </div>
  );
}
