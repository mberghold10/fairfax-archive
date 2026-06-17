import React, { useState } from 'react';
import Breadcrumbs from '../components/Breadcrumbs.jsx';
import '../styles/feedback-page.css';

/**
 * FeedbackPage — feedback form powered by Formspree.
 * Accepts feedback to improve the site or correct player/team information.
 */
export default function FeedbackPage() {
  const [status, setStatus] = useState('idle'); // idle | submitting | success | error
  const FORMSPREE_URL = 'https://formspree.io/f/mrevdvdg';

  const handleSubmit = async (e) => {
    e.preventDefault();
    setStatus('submitting');
    const form = e.target;
    const data = new FormData(form);

    try {
      const res = await fetch(FORMSPREE_URL, {
        method: 'POST',
        body: data,
        headers: { Accept: 'application/json' },
      });
      if (res.ok) {
        setStatus('success');
        form.reset();
      } else {
        setStatus('error');
      }
    } catch {
      setStatus('error');
    }
  };

  return (
    <div className="feedback-page">
      <Breadcrumbs crumbs={[{ label: 'Home', to: '/' }, { label: 'Feedback' }]} />

      <h1 className="feedback-page__title">Feedback</h1>

      <div className="feedback-page__intro">
        <p>
          Have a suggestion to improve the site, or spotted an error in a player's stats,
          team record, or game result? We'd love to hear from you. Whether it's a data
          correction, a feature request, or just a general comment — drop us a note below.
        </p>
        <p>
          If you're reporting incorrect player or team information, please include as much
          detail as possible (player name, season, division) so we can track it down.
        </p>
      </div>

      {status === 'success' ? (
        <div className="feedback-page__success" role="alert">
          <span className="feedback-page__success-icon" aria-hidden="true">✓</span>
          <p>Thanks for your feedback! We'll review it and make any corrections needed.</p>
        </div>
      ) : (
        <form
          className="feedback-page__form"
          onSubmit={handleSubmit}
          noValidate
        >
          <div className="feedback-page__field">
            <label htmlFor="fb-type" className="feedback-page__label">
              Feedback type
            </label>
            <select id="fb-type" name="type" className="feedback-page__select" required>
              <option value="">Select a category…</option>
              <option value="data-correction">Data correction (stats, roster, score)</option>
              <option value="feature-request">Feature request</option>
              <option value="site-issue">Site issue / bug</option>
              <option value="general">General feedback</option>
            </select>
          </div>

          <div className="feedback-page__field">
            <label htmlFor="fb-name" className="feedback-page__label">
              Your name <span className="feedback-page__optional">(optional)</span>
            </label>
            <input
              id="fb-name"
              name="name"
              type="text"
              className="feedback-page__input"
              placeholder="e.g. Chris Maroon"
              autoComplete="name"
            />
          </div>

          <div className="feedback-page__field">
            <label htmlFor="fb-email" className="feedback-page__label">
              Email <span className="feedback-page__optional">(optional — for follow-up)</span>
            </label>
            <input
              id="fb-email"
              name="email"
              type="email"
              className="feedback-page__input"
              placeholder="you@example.com"
              autoComplete="email"
            />
          </div>

          <div className="feedback-page__field">
            <label htmlFor="fb-message" className="feedback-page__label">
              Message <span className="feedback-page__required" aria-hidden="true">*</span>
            </label>
            <textarea
              id="fb-message"
              name="message"
              className="feedback-page__textarea"
              rows={6}
              required
              placeholder="Describe your feedback or correction in detail. For data corrections, please include the player name, season, and division."
            />
          </div>

          {status === 'error' && (
            <p className="feedback-page__error" role="alert">
              Something went wrong sending your feedback. Please try again or email us directly.
            </p>
          )}

          <button
            type="submit"
            className="feedback-page__submit"
            disabled={status === 'submitting'}
          >
            {status === 'submitting' ? 'Sending…' : 'Send Feedback'}
          </button>
        </form>
      )}
    </div>
  );
}
