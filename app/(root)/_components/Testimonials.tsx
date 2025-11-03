import React from 'react';
import { Star, Quote } from 'lucide-react';
import Image from 'next/image';

const Testimonials: React.FC = () => {
  const testimonials = [
    {
      name: 'Priya Sharma',
      role: 'HR Director',
      image: 'https://images.pexels.com/photos/774909/pexels-photo-774909.jpeg?auto=compress&cs=tinysrgb&w=150&h=150&fit=crop',
      content: 'Calibr transformed our hiring process completely. We reduced our time-to-hire by 70% and improved candidate quality significantly. The AI insights are incredibly accurate.',
      rating: 5
    },
    {
      name: 'Rahul Kapoor',
      role: 'Talent Acquisition Head',
      image: 'https://images.pexels.com/photos/1222271/pexels-photo-1222271.jpeg?auto=compress&cs=tinysrgb&w=150&h=150&fit=crop',
      content: 'The bias-free evaluation feature is a game-changer. We\'ve seen a 40% increase in diverse hires while maintaining high quality standards. Highly recommended!',
      rating: 5
    },
    {
      name: 'Ananya Patel',
      role: 'Recruitment Manager',
      image: 'https://images.pexels.com/photos/1239291/pexels-photo-1239291.jpeg?auto=compress&cs=tinysrgb&w=150&h=150&fit=crop',
      content: 'The automated scheduling and instant reports save us countless hours. Our team can now focus on strategic hiring decisions rather than administrative tasks.',
      rating: 5
    }
  ];

  const certifications = [
    { name: 'GDPR Compliant', badge: 'GDPR' },
    { name: 'ISO 27001', badge: 'ISO' },
    { name: 'SOC 2 Type II', badge: 'SOC2' },
    { name: 'CCPA Ready', badge: 'CCPA' }
  ];

  return (
    <section id="testimonials" className="py-20 bg-gradient-to-br from-[#0A0A18] to-[#0D0D20]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <h2 className="text-4xl font-bold text-white mb-4">
            Trusted by <span className="bg-gradient-to-r from-indigo-300 to-rose-300 bg-clip-text text-transparent">Leading</span> Teams
          </h2>
          <p className="text-xl text-white/60 max-w-3xl mx-auto">
            Join hundreds of organizations that have revolutionized their hiring process with Calibr
          </p>
        </div>

        {/* Testimonials */}
        <div className="grid md:grid-cols-3 gap-8 mb-16">
          {testimonials.map((testimonial, index) => (
            <div key={index} className="bg-white/5 backdrop-blur-sm rounded-2xl p-8 border border-white/10 hover:border-white/20 transition-all duration-300">
              <div className="flex items-center mb-4">
                {[...Array(testimonial.rating)].map((_, i) => (
                  <Star key={i} className="h-5 w-5 text-amber-400 fill-current" />
                ))}
              </div>
              
              <div className="relative mb-6">
                <Quote className="absolute -top-2 -left-2 h-8 w-8 text-indigo-500/30" />
                <p className="text-white/80 leading-relaxed pl-6">
                  {testimonial.content}
                </p>
              </div>
              
              <div className="flex items-center">
                <Image
                  src={testimonial.image}
                  alt={testimonial.name}
                  width={48}
                  height={48}
                  className="w-12 h-12 rounded-full object-cover mr-4 border-2 border-white/20"
                />
                <div>
                  <div className="font-semibold text-white">{testimonial.name}</div>
                  <div className="text-sm text-white/60">{testimonial.role}</div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Trust & Security */}
        <div className="bg-white/5 backdrop-blur-sm rounded-2xl p-8 lg:p-12 border border-white/10">
          <div className="text-center mb-8">
            <h3 className="text-2xl font-bold text-white mb-4">
              Security & Compliance You Can Trust
            </h3>
            <p className="text-white/60 max-w-2xl mx-auto">
              Your data security is our priority. Calibr meets the highest industry standards 
              for data protection and privacy compliance.
            </p>
          </div>
          
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            {certifications.map((cert, index) => (
              <div key={index} className="text-center">
                <div className="w-16 h-16 bg-gradient-to-br from-indigo-500/20 to-rose-500/20 rounded-2xl flex items-center justify-center mx-auto mb-3 border border-white/10">
                  <span className="text-white font-bold text-sm">{cert.badge}</span>
                </div>
                <div className="text-sm font-medium text-white/80">{cert.name}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};

export default Testimonials;